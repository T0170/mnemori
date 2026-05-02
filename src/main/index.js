/**
 * Main Electron process.
 *
 * Responsibilities:
 *  - Create the app window
 *  - Manage the recording lifecycle (spawn ffmpeg)
 *  - Transcribe audio via OpenAI Whisper API
 *  - Generate documents via Anthropic Claude API
 *  - Persist recording metadata to a local SQLite database
 *  - Expose all of the above to the renderer via IPC
 */

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, protocol, net, session, safeStorage, globalShortcut, screen, desktopCapturer, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const Database = require('better-sqlite3');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');

const isDev = !app.isPackaged;
const isMac = process.platform === 'darwin';

// ---- Single-instance lock ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ---- Global error handlers ----
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  try { auditLog('app:crash', null, `uncaughtException: ${err.message}`); } catch (_) {}
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  try { auditLog('app:crash', null, `unhandledRejection: ${String(reason)}`); } catch (_) {}
});

// ---- Paths ----
const userDataDir = app.getPath('userData');
const defaultRecordingsDir = path.join(userDataDir, 'recordings');
const dbPath = path.join(userDataDir, 'mnemori.db');

if (!fs.existsSync(defaultRecordingsDir)) fs.mkdirSync(defaultRecordingsDir, { recursive: true });

// ---- ffmpeg resolution ----
function findFfmpeg() {
  // Prefer bundled ffmpeg-static
  try {
    let staticPath = require('ffmpeg-static');
    if (!isDev) staticPath = staticPath.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(staticPath)) return staticPath;
  } catch (_) {}

  // Fall back to system-installed ffmpeg
  const candidates = isMac
    ? ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']
    : [
        path.join(process.env.USERPROFILE || '', 'ffmpeg', 'ffmpeg-8.1-essentials_build', 'bin', 'ffmpeg.exe'),
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        path.join(process.env.LOCALAPPDATA || '', 'ffmpeg', 'bin', 'ffmpeg.exe'),
      ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }
  return 'ffmpeg';
}
const FFMPEG = findFfmpeg();

// macOS: parse avfoundation video + audio devices
async function getAvfoundationDevices() {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, ['-f', 'avfoundation', '-list_devices', 'true', '-i', '']);
    let output = '';
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.on('error', () => resolve({ video: [], audio: [] }));
    proc.on('close', () => {
      const video = [];
      const audio = [];
      let section = null;
      for (const line of output.split('\n')) {
        if (line.includes('video devices')) { section = 'video'; continue; }
        if (line.includes('audio devices')) { section = 'audio'; continue; }
        const m = line.match(/\[(\d+)\]\s+(.+)/);
        if (m && section) {
          (section === 'video' ? video : audio).push({ index: parseInt(m[1]), name: m[2].trim() });
        }
      }
      resolve({ video, audio });
    });
  });
}

// ---- Database ----
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    duration_seconds INTEGER,
    video_path TEXT,
    audio_path TEXT,
    transcript_path TEXT,
    project TEXT,
    tags TEXT,
    status TEXT NOT NULL DEFAULT 'recorded'
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (recording_id) REFERENCES recordings(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    ip TEXT
  );
`);

try { db.exec('ALTER TABLE projects ADD COLUMN summary TEXT DEFAULT ""'); } catch (_) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS profile (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS profile_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    filler_count INTEGER DEFAULT 0,
    self_corrections INTEGER DEFAULT 0,
    hedging_count INTEGER DEFAULT 0,
    confidence_score REAL DEFAULT 0,
    topics TEXT DEFAULT '[]',
    concepts TEXT DEFAULT '[]',
    strengths TEXT DEFAULT '[]',
    growth_edges TEXT DEFAULT '[]',
    raw_json TEXT DEFAULT '{}',
    FOREIGN KEY (recording_id) REFERENCES recordings(id)
  );

  CREATE TABLE IF NOT EXISTS coaching_readouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    content TEXT NOT NULL,
    recording_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    metric TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'decrease',
    created_at INTEGER NOT NULL,
    achieved_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (goal_id) REFERENCES goals(id)
  );

  CREATE TABLE IF NOT EXISTS screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id TEXT NOT NULL,
    timestamp_ms INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (recording_id) REFERENCES recordings(id)
  );
`);

// FTS5 full-text search index
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    recording_id,
    type,
    content,
    tokenize='porter unicode61'
  );
`);

function indexTranscript(recordingId, text) {
  db.prepare('DELETE FROM search_index WHERE recording_id = ? AND type = ?').run(recordingId, 'transcript');
  db.prepare('INSERT INTO search_index (recording_id, type, content) VALUES (?, ?, ?)').run(recordingId, 'transcript', text);
}

function indexArtifact(recordingId, mode, text) {
  db.prepare('DELETE FROM search_index WHERE recording_id = ? AND type = ?').run(recordingId, mode);
  db.prepare('INSERT INTO search_index (recording_id, type, content) VALUES (?, ?, ?)').run(recordingId, mode, text);
}

function rebuildSearchIndex() {
  const count = db.prepare('SELECT COUNT(*) as n FROM search_index').get().n;
  if (count > 0) return;

  const recordings = db.prepare('SELECT id, transcript_path FROM recordings WHERE transcript_path IS NOT NULL').all();
  for (const rec of recordings) {
    try {
      if (rec.transcript_path && fs.existsSync(rec.transcript_path)) {
        const text = fs.readFileSync(rec.transcript_path, 'utf-8');
        indexTranscript(rec.id, text);
      }
    } catch (_) {}
  }

  const artifacts = db.prepare('SELECT recording_id, mode, content FROM artifacts').all();
  for (const a of artifacts) {
    try { indexArtifact(a.recording_id, a.mode, a.content); } catch (_) {}
  }
}

// ---- Audit logging ----
function auditLog(action, target = null, detail = null) {
  db.prepare(
    'INSERT INTO audit_log (timestamp, action, target, detail) VALUES (?, ?, ?, ?)'
  ).run(Date.now(), action, target, detail);
}

// ---- Secure credential storage ----
// Uses Electron safeStorage (DPAPI on Windows, Keychain on macOS) with
// a plaintext fallback when safeStorage is unavailable (e.g. Linux without a keyring).

function encryptValue(plaintext) {
  if (!plaintext) return '';
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(plaintext).toString('base64');
  }
  return plaintext;
}

function decryptValue(stored) {
  if (!stored) return '';
  if (stored.startsWith('enc:')) {
    try {
      const buf = Buffer.from(stored.slice(4), 'base64');
      return safeStorage.decryptString(buf);
    } catch (_) {
      return '';
    }
  }
  return stored;
}

const ENCRYPTED_KEYS = new Set(['openaiApiKey', 'anthropicApiKey']);

// ---- Secure file deletion ----
function secureDelete(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    const fd = fs.openSync(filePath, 'w');
    const zeros = Buffer.alloc(Math.min(stat.size, 65536), 0);
    let written = 0;
    while (written < stat.size) {
      const chunk = Math.min(zeros.length, stat.size - written);
      fs.writeSync(fd, zeros, 0, chunk);
      written += chunk;
    }
    fs.closeSync(fd);
    fs.unlinkSync(filePath);
  } catch (_) {
    try { fs.unlinkSync(filePath); } catch (_) {}
  }
}

// ---- Data retention ----
function enforceRetention() {
  const days = parseInt(getSetting('retentionDays'), 10);
  if (!days || days <= 0) return;
  const cutoff = Date.now() - days * 86400000;
  const expired = db.prepare(
    'SELECT * FROM recordings WHERE created_at < ? AND status != ?'
  ).all(cutoff, 'recording');

  for (const rec of expired) {
    for (const f of [rec.video_path, rec.audio_path, rec.transcript_path]) {
      if (f) secureDelete(f);
    }
    const jsonPath = rec.audio_path?.replace(/\.wav$/, '.json');
    if (jsonPath) secureDelete(jsonPath);
    const ssFiles = db.prepare('SELECT file_path FROM screenshots WHERE recording_id = ?').all(rec.id);
    for (const ss of ssFiles) { if (ss.file_path) secureDelete(ss.file_path); }
    const deleteAll = db.transaction(() => {
      db.prepare('DELETE FROM screenshots WHERE recording_id = ?').run(rec.id);
      db.prepare('DELETE FROM artifacts WHERE recording_id = ?').run(rec.id);
      db.prepare('DELETE FROM search_index WHERE recording_id = ?').run(rec.id);
      db.prepare('DELETE FROM profile_insights WHERE recording_id = ?').run(rec.id);
      db.prepare('DELETE FROM recordings WHERE id = ?').run(rec.id);
    });
    deleteAll();
    auditLog('retention:delete', rec.id, `auto-deleted after ${days}-day retention policy`);
  }
}

// ---- Recording state ----
let mainWindow = null;
let videoProcess = null;
let activeRecordingId = null;
let recordingStartTime = null;

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  return ENCRYPTED_KEYS.has(key) ? decryptValue(row.value) : row.value;
}

function setSetting(key, value) {
  const stored = ENCRYPTED_KEYS.has(key) ? encryptValue(value) : value;
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, stored);
}

function getRecordingsDir() {
  const custom = getSetting('storagePath');
  if (custom && fs.existsSync(custom)) return custom;
  return defaultRecordingsDir;
}

// Migrate any plaintext API keys to encrypted storage on startup
function migrateCredentials() {
  if (!safeStorage.isEncryptionAvailable()) return;
  for (const key of ENCRYPTED_KEYS) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row && row.value && !row.value.startsWith('enc:')) {
      const encrypted = encryptValue(row.value);
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(encrypted, key);
      auditLog('credential:migrated', key, 'migrated from plaintext to encrypted storage');
    }
  }
}

// ---- Prompts ----
const PROMPTS = {
  sop: `You are an expert technical writer converting a narrated screen recording into a Standard Operating Procedure that someone else could follow without the video.

The transcript below is raw speech — expect filler words ("um," "uh," "like"), false starts, self-corrections ("wait, no, I meant"), and thinking-out-loud tangents. Your job is to extract the actual procedure from the noise.

Produce the SOP in this exact structure:

# [Specific, descriptive title of the procedure]

## Purpose
One to two sentences: what this accomplishes and when someone would need to do it.

## Prerequisites
- List every tool, permission, account, or piece of information needed before starting
- If the narrator assumed something was already set up, include it here

## Steps
Number every discrete action. Write each step as a direct instruction ("Click X," "Navigate to Y," "Enter the value Z"). Include:
- The exact UI elements, menu paths, field names, or commands the narrator mentioned
- Specific values, settings, or configurations they used
- Where to look for confirmation that each step worked

Do NOT include the narrator's reasoning or tangents in the steps themselves — only the actions.

## Warnings and gotchas
Anything the narrator flagged as tricky, surprising, or easy to get wrong. Also include things they corrected themselves on mid-narration — those self-corrections reveal real pitfalls.

## Open questions
Things the narrator expressed uncertainty about, left unresolved, or said they'd need to revisit. If there are none, omit this section.

Rules:
- Be faithful to what was actually done. Never invent steps or fill in gaps with assumptions.
- If the narrator did something out of order and then corrected course, present the steps in the correct order with a note about the correction in Warnings.
- Keep the language direct and scannable. No filler prose between sections.

TRANSCRIPT:
{transcript}`,

  methodology: `You are producing a methodology document from a narrated screen recording — a document that explains what was built and the reasoning behind how it was designed.

This is not a step-by-step procedure (that's an SOP). This is the architectural rationale: what decisions were made, why, what trade-offs were weighed, and how the pieces fit together. The audience is someone who needs to understand the system — a client, a teammate, or the builder themselves six months from now.

The transcript is raw narration — expect thinking out loud, filler, false starts, and real-time problem-solving. Extract the design reasoning from the noise.

Produce the document in this structure:

# [System/build name — infer from context]

## What was built
A concise description of the system, tool, workflow, or structure that was created. What it does, who it's for, and the problem it solves.

## Architecture and design decisions
For each significant design choice:
- **What was decided** — the specific choice (e.g., "Used a junction table instead of a multi-select field")
- **Why** — the reasoning the builder gave, or the constraint that drove the decision
- **Trade-offs** — what was gained and what was given up, if the narrator discussed alternatives

Group related decisions together. Use the builder's own terminology.

## How the components connect
Describe how the pieces of the build relate to each other — the relationships, dependencies, data flow, or logic chain. This is the mental model someone needs to work on the system confidently.

## Assumptions and constraints
Things the build depends on that aren't obvious: data format expectations, permission requirements, upstream systems, volume assumptions, or business rules baked into the design.

## Open design questions
Anything the builder flagged as uncertain, provisional, or "good enough for now." Decisions they deferred or want to revisit. Omit if none.

Rules:
- Prioritize the *why* over the *what*. The build itself is visible; the reasoning behind it is what gets lost.
- When the narrator considered alternatives and rejected them, capture that — rejected options are as valuable as chosen ones.
- Self-corrections during narration often reveal real design tensions. Preserve them as trade-off discussions, not mistakes.
- Use specific names: field names, table names, automation names, actual values. Generic descriptions are useless in a methodology doc.
- Write for someone who is technically competent but has never seen this build before.

TRANSCRIPT:
{transcript}`,

  coaching: `You are an expert skill coach reviewing a narrated screen recording to help someone accelerate their learning.

The person recorded themselves narrating their reasoning while working through a task. This transcript is raw speech — expect disfluency, self-talk, and real-time problem-solving. That messiness is the signal: hesitations, self-corrections, and verbal uncertainty reveal exactly where learning is happening.

Produce a coaching review in this structure:

# Coaching Review

## Strong moves
Identify 2-4 specific moments where the narrator demonstrated good reasoning, correct instinct, or effective technique. Quote or closely paraphrase what they said to anchor each observation. Explain *why* it was a good move — what principle or skill it reflects.

## Growth edges
Identify moments of hesitation, uncertainty, confusion, or self-correction. For each one:
- Describe what happened (quote their words when useful)
- Name the underlying concept or skill gap
- Explain what the confident version of that action looks like

These are not failures — frame them as the frontier where learning is actively happening.

## Concepts to reinforce
List the specific technical concepts, terms, or mental models the narrator engaged with but didn't seem fully solid on. For each, give a one-sentence explanation of what it is and why it matters — just enough to orient further study.

## Recommended next steps
Suggest 2-3 concrete, specific exercises or tasks that would strengthen the exact skills this session revealed as developing. Each should be doable in a single sitting and directly related to what was attempted.

Rules:
- Be specific, not generic. "Good job navigating the interface" is useless. "You correctly identified that the rollup field needed to reference the linked record before aggregating" is useful.
- Treat self-corrections as gold — they show the narrator catching their own mistakes, which is a skill in itself.
- The tone is that of a respected mentor: warm, direct, never condescending.

TRANSCRIPT:
{transcript}`,

  notes: `You are cleaning up a narrated screen recording into polished, readable notes that preserve the narrator's thinking and reasoning.

The transcript is raw speech — full of filler words, restarts, verbal tics ("um," "so," "basically"), and mid-thought corrections. Your job is to produce notes that read like the narrator sat down afterward and wrote out what they did and why, in their own voice.

Guidelines:
- Strip all filler words, false starts, and verbal noise
- Preserve the narrator's actual reasoning, decisions, and observations — the *why* behind what they did
- Keep domain-specific terminology exactly as the narrator used it
- Add structure: use headings to mark topic shifts, paragraph breaks for readability
- When the narrator corrected themselves ("wait, no, actually..."), keep the corrected version and drop the false start — unless the mistake itself is informative
- Do not summarize away substance. If they explained something in detail, keep the detail
- Do not add information, opinions, or context the narrator didn't provide
- Output clean Markdown with natural paragraph flow, not bullet-point outlines

The result should feel like well-edited first-person notes — something the narrator would recognize as their own thinking, just cleaner.

TRANSCRIPT:
{transcript}`,

  title: `Given this transcript of a narrated screen recording, generate a concise, descriptive title (5-8 words). The title should name the specific task or topic — not a generic label. Return ONLY the title text, nothing else. No quotes, no punctuation unless part of a proper name.

TRANSCRIPT:
{transcript}`,

  project_summary: `You are synthesizing multiple narrated screen recording sessions from the same project into a comprehensive project document.

The transcripts below are ordered chronologically. Each represents a separate work session where someone narrated what they were doing and why. Produce a living project summary that weaves everything together.

# Project Summary

## Overview
2-3 sentences: what this project is, based on everything discussed across all sessions.

## Timeline
For each session, a brief entry:
- When it happened
- What was accomplished
- Key decisions made

## Key decisions and reasoning
The major choices made across sessions, with the person's stated reasoning. The "why" behind each decision is the most valuable part — preserve it faithfully.

## Conflicts and course corrections
Places where the person changed their mind, contradicted an earlier approach, or revised their thinking:
- What they originally thought or did
- What they changed to
- Why (if stated)

These are not mistakes — they are the evolution of understanding. Frame them as valuable signal.

## Current state
Where things stand as of the most recent session. What works, what's pending, what's unresolved.

## Open questions
Anything left unresolved, flagged for revisiting, or explicitly uncertain across any session. Omit if none.

Rules:
- Synthesize across sessions, don't just summarize each one in order
- When the same topic appears in multiple sessions, weave those mentions together
- Use the person's own terminology
- Be specific — names, field names, technical terms, actual values mentioned
- Keep the document scannable: strong headings, short paragraphs, bullet points for lists

TRANSCRIPTS:
{transcript}`,
};

const EXTRACT_PROMPT = `Analyze this transcript of a narrated screen recording for communication patterns and concepts. Return ONLY valid JSON with this exact structure — no markdown, no code fences, no explanation:

{
  "filler_count": <number of filler words: um, uh, like (as filler), you know, basically, so (as filler), right (as filler)>,
  "self_corrections": <number of times the speaker corrected themselves: "wait no", "actually", "I mean", backtracking>,
  "hedging_count": <number of hedging phrases: "I think maybe", "I'm not sure", "probably", "kind of", "I guess">,
  "confidence_score": <0.0 to 1.0 — how confidently the speaker communicated overall. 1.0 = authoritative and fluid, 0.0 = deeply uncertain>,
  "topics": [<list of 3-8 specific topics discussed, as short strings>],
  "concepts": [<technical terms, tools, or domain-specific concepts mentioned — exact terminology used>],
  "strengths": [<1-3 specific communication strengths observed in this session>],
  "growth_edges": [<1-3 specific areas where communication could improve, based on this session>]
}

TRANSCRIPT:
{transcript}`;

const COACHING_READOUT_PROMPT = `You are a professional development coach producing a longitudinal coaching readout. You have two inputs: the person's self-described profile, and structured data from their recent recording sessions.

Your tone is that of a respected mentor — warm, direct, never condescending, but firm when something needs to be said. You know this person's goals and you're invested in helping them get there.

Produce the readout in this structure:

# Coaching Readout

## Who you are (reflected back)
Briefly mirror back who this person is and what they're working toward, based on their profile. This grounds the readout and shows you've listened.

## Communication strengths
What this person does well consistently across sessions. Be specific — quote patterns, name behaviors. These are things to keep doing.

## Growth edges
Where the data shows room to improve. For each edge:
- What the pattern is (with specifics — filler word frequency, hedging tendencies, etc.)
- Why it matters for their stated goals
- One concrete thing to try next session

## Trends
What's changing over time. Are filler words decreasing? Is confidence on certain topics growing? Are new concepts appearing? This is the section that makes longitudinal coaching valuable.

## Recommended focus
2-3 specific, actionable things to work on in the next few sessions. Tied directly to their goals. Each should be doable and measurable.

Rules:
- Be specific, not generic. "Try to speak more confidently" is useless. "Your hedging drops to near-zero when discussing interface design but spikes when explaining automations — that's your next frontier" is useful.
- Reference the data: mention actual numbers, actual topics, actual patterns.
- Frame growth edges as frontiers, not failures.
- Keep it under 800 words. Scannable, not sprawling.

PROFILE:
{profile}

SESSION DATA:
{data}`;

// ---- Profile helpers ----

function getProfile(key) {
  const row = db.prepare('SELECT value FROM profile WHERE key = ?').get(key);
  return row ? row.value : '';
}

function setProfile(key, value) {
  db.prepare(
    'INSERT INTO profile (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

function getAllProfile() {
  const rows = db.prepare('SELECT key, value FROM profile').all();
  const result = {};
  for (const r of rows) result[r.key] = r.value;
  return result;
}

function isProfileComplete() {
  const required = ['name', 'role', 'goals'];
  return required.every((k) => !!getProfile(k));
}

async function extractInsights(recordingId) {
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(recordingId);
  if (!rec || !rec.transcript_path || !fs.existsSync(rec.transcript_path)) return;

  const existing = db.prepare('SELECT id FROM profile_insights WHERE recording_id = ?').get(recordingId);
  if (existing) return;

  const transcript = fs.readFileSync(rec.transcript_path, 'utf-8');
  if (!transcript.trim()) return;

  try {
    const raw = await generateWithClaude(transcript, null, EXTRACT_PROMPT);
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const data = JSON.parse(cleaned);

    db.prepare(`
      INSERT INTO profile_insights (recording_id, created_at, filler_count, self_corrections, hedging_count, confidence_score, topics, concepts, strengths, growth_edges, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      recordingId,
      Date.now(),
      data.filler_count || 0,
      data.self_corrections || 0,
      data.hedging_count || 0,
      data.confidence_score || 0,
      JSON.stringify(data.topics || []),
      JSON.stringify(data.concepts || []),
      JSON.stringify(data.strengths || []),
      JSON.stringify(data.growth_edges || []),
      JSON.stringify(data)
    );
    auditLog('concepts:extract', recordingId, 'success');
  } catch (err) {
    auditLog('concepts:extract', recordingId, `error: ${err.message}`);
  }
}

// ---- API helpers ----

async function transcribeAudio(wavPath) {
  const apiKey = getSetting('openaiApiKey');
  if (!apiKey) throw new Error('OpenAI API key not configured. Add it in Administration.');

  let result;
  try {
    const client = new OpenAI({ apiKey });
    result = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(wavPath),
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      throw new Error('Could not reach OpenAI — check your internet connection and try again.');
    }
    if (err.status === 401) throw new Error('OpenAI API key is invalid. Update it in Administration.');
    if (err.status === 429) throw new Error('OpenAI rate limit reached. Wait a moment and try again.');
    throw err;
  }

  const txtPath = wavPath.replace(/\.wav$/, '.txt');
  fs.writeFileSync(txtPath, result.text, 'utf-8');

  const jsonPath = wavPath.replace(/\.wav$/, '.json');
  const segments = (result.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text }));
  fs.writeFileSync(jsonPath, JSON.stringify(segments, null, 2), 'utf-8');

  return txtPath;
}

async function generateWithClaude(text, mode, customPrompt = null, screenshotContext = null) {
  const apiKey = getSetting('anthropicApiKey');
  if (!apiKey) throw new Error('Anthropic API key not configured. Add it in Administration.');

  const prompt = customPrompt || PROMPTS[mode];
  if (!prompt) throw new Error(`Unknown generation mode: ${mode}`);

  let response;
  try {
    const client = new Anthropic({ apiKey });

    let systemMsg;
    let userContent;

    if (text && prompt.includes('{transcript}')) {
      systemMsg = prompt.replace(/\n?TRANSCRIPT:\n?\{transcript\}/, '').trim();

      if (screenshotContext && screenshotContext.length > 0) {
        systemMsg += '\n\nThe user also captured screenshots at specific moments during the recording. Each screenshot is shown with its timestamp and the surrounding transcript context. Reference these screenshots in your output where relevant — describe what they show and how it relates to what was being discussed. Label each as "Screenshot at [timestamp]" and weave them into the appropriate section.';

        userContent = [{ type: 'text', text }];
        for (const ss of screenshotContext) {
          userContent.push({
            type: 'text',
            text: `\n--- Screenshot at ${ss.label} ---\nTranscript context: "${ss.context}"`,
          });
          userContent.push({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: ss.base64 },
          });
        }
      } else {
        userContent = text;
      }
    } else {
      systemMsg = 'Follow the instructions and produce the requested output.';
      userContent = customPrompt || prompt.replace('{transcript}', text);
    }

    response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: mode === 'title' ? 100 : 8000,
      system: systemMsg,
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      throw new Error('Could not reach Anthropic — check your internet connection and try again.');
    }
    if (err.status === 401) throw new Error('Anthropic API key is invalid. Update it in Administration.');
    if (err.status === 429) throw new Error('Anthropic rate limit reached. Wait a moment and try again.');
    throw err;
  }

  return response.content[0].text;
}

function formatTimestampLabel(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function buildScreenshotContext(recordingId, segments) {
  const screenshots = db.prepare(
    'SELECT * FROM screenshots WHERE recording_id = ? ORDER BY timestamp_ms ASC'
  ).all(recordingId);
  if (screenshots.length === 0) return null;

  const result = [];
  for (const ss of screenshots) {
    if (!ss.file_path || !fs.existsSync(ss.file_path)) continue;

    const base64 = fs.readFileSync(ss.file_path).toString('base64');
    const tSec = ss.timestamp_ms / 1000;

    let context = '';
    if (segments.length > 0) {
      const nearby = segments.filter((s) => Math.abs(s.start - tSec) < 15 || (s.start <= tSec && s.end >= tSec));
      if (nearby.length > 0) {
        context = nearby.map((s) => s.text.trim()).join(' ');
      } else {
        const closest = segments.reduce((best, s) => Math.abs(s.start - tSec) < Math.abs(best.start - tSec) ? s : best);
        context = closest.text.trim();
      }
    }

    result.push({
      label: formatTimestampLabel(ss.timestamp_ms),
      context: context || '(no transcript context available)',
      base64,
    });
  }
  return result.length > 0 ? result : null;
}

// ---- Window ----

function createWindow() {
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0f0e0c',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    ...(isMac ? {} : { titleBarOverlay: { color: '#f3ede1', symbolColor: '#1a1714', height: 36 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; media-src media:; connect-src media: https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' data: media: https://img.clerk.com; worker-src 'self' blob:;"],
        },
      });
    });
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
    mainWindow.webContents.on('devtools-opened', () => { mainWindow.webContents.closeDevTools(); });
  }
}

// ---- Overlay window ----

let overlayWindow = null;
const DEFAULT_HOTKEY = 'CommandOrControl+Shift+M';

function createOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return;

  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 256,
    height: 52,
    x: width - 276,
    y: height - 72,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'floating');
  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWindow.once('ready-to-show', () => overlayWindow.show());
  overlayWindow.on('closed', () => { overlayWindow = null; });
}

function destroyOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }
  overlayWindow = null;
}

async function doStartRecording(options = {}) {
  if (videoProcess) return { ok: false, error: 'Already recording' };

  const audioDevice = options.audioDevice || getSetting('audioDevice');
  if (!audioDevice) return { ok: false, error: 'No audio device configured. Open Settings.' };

  try {
    const recDir = getRecordingsDir();
    const stats = fs.statfsSync(recDir);
    const freeBytes = stats.bfree * stats.bsize;
    if (freeBytes < 500 * 1024 * 1024) {
      return { ok: false, error: 'Less than 500 MB of disk space available. Free up space before recording.' };
    }
  } catch (_) {}

  const id = `rec_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const basePath = path.join(getRecordingsDir(), id);
  const videoPath = `${basePath}.mp4`;
  const audioPath = `${basePath}.wav`;

  if (isMac) {
    const devices = await getAvfoundationDevices();
    const screenDev = devices.video.find((d) => d.name.includes('Capture screen'));
    const audioDev = devices.audio.find((d) => d.name === audioDevice);
    if (!screenDev) return { ok: false, error: 'No screen capture device found. Grant Screen Recording permission in System Settings.' };
    if (!audioDev) return { ok: false, error: `Audio device "${audioDevice}" not found.` };

    videoProcess = spawn(FFMPEG, [
      '-y',
      '-f', 'avfoundation', '-framerate', '15', '-capture_cursor', '1',
      '-i', `${screenDev.index}:${audioDev.index}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      videoPath,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
  } else {
    videoProcess = spawn(FFMPEG, [
      '-y',
      '-f', 'gdigrab', '-framerate', '15', '-i', 'desktop',
      '-f', 'dshow', '-i', `audio=${audioDevice}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      videoPath,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
  }
  activeRecordingId = id;
  recordingStartTime = Date.now();

  // Wait briefly to see if ffmpeg exits immediately (bad device, missing codec, etc.)
  const earlyExit = await new Promise((resolve) => {
    const onError = () => resolve(true);
    const onClose = (code) => { if (code !== 0) resolve(true); };
    videoProcess.on('error', onError);
    videoProcess.on('close', onClose);
    setTimeout(() => {
      videoProcess.removeListener('error', onError);
      videoProcess.removeListener('close', onClose);
      resolve(false);
    }, 1500);
  });

  if (earlyExit) {
    videoProcess = null;
    activeRecordingId = null;
    recordingStartTime = null;
    try { fs.unlinkSync(videoPath); } catch (_) {}
    return { ok: false, error: `Recording failed — check that audio device "${audioDevice}" is connected and available.` };
  }

  // ffmpeg is running — watch for unexpected exit mid-recording
  videoProcess.on('close', (code) => {
    if (code !== 0 && activeRecordingId === id) {
      videoProcess = null;
      const duration = Math.round((Date.now() - recordingStartTime) / 1000);
      db.prepare('UPDATE recordings SET duration_seconds = ?, status = ? WHERE id = ?').run(duration, 'error', id);
      activeRecordingId = null;
      recordingStartTime = null;
      auditLog('recording:error', id, `ffmpeg exited unexpectedly with code ${code}`);
      overlayWindow?.webContents.send('overlay:stopped');
      destroyOverlay();
      mainWindow?.webContents.send('recordings:changed');
    }
  });

  const title = options.title || new Date().toLocaleString();
  db.prepare(`
    INSERT INTO recordings (id, title, created_at, video_path, audio_path, project, tags, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'recording')
  `).run(id, title, recordingStartTime, videoPath, audioPath, options.project || '', options.tags || '');

  auditLog('recording:start', id, `device="${audioDevice}"`);
  createOverlay();
  setTimeout(() => overlayWindow?.webContents.send('overlay:started', recordingStartTime), 500);
  try { globalShortcut.register(SCREENSHOT_HOTKEY, () => { captureScreenshot(); }); } catch (_) {}
  mainWindow?.webContents.send('recordings:changed');
  return { ok: true, id };
}

async function doStopRecording() {
  if (!videoProcess) return { ok: false, error: 'Not recording' };

  const id = activeRecordingId;
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);

  try { videoProcess.stdin.write('q'); } catch (_) {}

  await new Promise((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    videoProcess.on('close', done);
    setTimeout(() => { try { videoProcess.kill(); } catch (_) {} done(); }, 8000);
  });

  videoProcess = null;

  const duration = Math.round((Date.now() - recordingStartTime) / 1000);
  let status = 'recorded';

  if (rec && rec.video_path && fs.existsSync(rec.video_path)) {
    const stat = fs.statSync(rec.video_path);
    if (stat.size < 1024) {
      status = 'error';
      auditLog('recording:error', id, `video file too small (${stat.size} bytes) — likely no valid capture`);
    } else {
      await new Promise((resolve) => {
        const extract = spawn(FFMPEG, ['-y', '-i', rec.video_path, '-vn', '-ac', '1', '-ar', '16000', rec.audio_path]);
        extract.on('error', () => resolve());
        extract.on('close', (code) => {
          if (code !== 0) {
            status = 'error';
            auditLog('recording:error', id, 'WAV extraction from MP4 failed');
          }
          resolve();
        });
      });
    }
  } else {
    status = 'error';
    auditLog('recording:error', id, 'no video file produced');
  }

  db.prepare('UPDATE recordings SET duration_seconds = ?, status = ? WHERE id = ?').run(duration, status, id);

  activeRecordingId = null;
  recordingStartTime = null;

  auditLog('recording:stop', id, `duration=${duration}s`);
  try { globalShortcut.unregister(SCREENSHOT_HOTKEY); } catch (_) {}
  overlayWindow?.webContents.send('overlay:stopped');
  destroyOverlay();
  mainWindow?.webContents.send('recordings:changed');

  if (status === 'recorded') {
    runAutoPipeline(id).catch(() => {});
  }

  return { ok: true, id };
}

async function captureScreenshot() {
  if (!videoProcess || !activeRecordingId || !recordingStartTime) {
    return { ok: false, error: 'No active recording' };
  }

  const timestampMs = Date.now() - recordingStartTime;
  const fileName = `${activeRecordingId}_screenshot_${timestampMs}.png`;
  const filePath = path.join(getRecordingsDir(), fileName);

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    if (!sources || sources.length === 0) {
      return { ok: false, error: 'No screen source available' };
    }

    const pngBuffer = sources[0].thumbnail.toPNG();
    fs.writeFileSync(filePath, pngBuffer);

    db.prepare(
      'INSERT INTO screenshots (recording_id, timestamp_ms, file_path, created_at) VALUES (?, ?, ?, ?)'
    ).run(activeRecordingId, timestampMs, filePath, Date.now());

    auditLog('screenshot:capture', activeRecordingId, `at ${timestampMs}ms`);
    overlayWindow?.webContents.send('overlay:screenshotCaptured');

    return { ok: true, timestamp_ms: timestampMs, file_path: filePath };
  } catch (err) {
    auditLog('screenshot:error', activeRecordingId, err.message);
    return { ok: false, error: err.message };
  }
}

async function runAutoPipeline(recordingId) {
  if (getSetting('policyAutoPipelineDisabled') === 'true') return;
  const autoTranscribe = getSetting('autoTranscribe') === 'true';
  if (!autoTranscribe) return;

  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(recordingId);
  if (!rec || !rec.audio_path) return;

  db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('transcribing', recordingId);
  mainWindow?.webContents.send('recordings:changed');

  try {
    const transcriptPath = await transcribeAudio(rec.audio_path);
    db.prepare('UPDATE recordings SET transcript_path = ?, status = ? WHERE id = ?')
      .run(transcriptPath, 'transcribed', recordingId);
    mainWindow?.webContents.send('recordings:changed');
    const transcriptText = fs.readFileSync(transcriptPath, 'utf-8');
    indexTranscript(recordingId, transcriptText);
    auditLog('pipeline:auto-transcribe', recordingId, 'success');
    if (getSetting('conceptsAutoExtract') === 'true' && getSetting('policyConceptsDisabled') !== 'true') {
      await extractInsights(recordingId);
    }

    try {
      const newTitle = (await generateWithClaude(transcriptText, 'title')).trim();
      if (newTitle && newTitle.length < 100) {
        db.prepare('UPDATE recordings SET title = ? WHERE id = ?').run(newTitle, recordingId);
        mainWindow?.webContents.send('recordings:changed');
      }
    } catch (_) {}

    const autoMode = getSetting('autoGenerateMode');
    if (autoMode && ['sop', 'methodology', 'coaching', 'notes'].includes(autoMode)) {
      let autoSegments = [];
      const autoJsonPath = rec.audio_path?.replace(/\.wav$/, '.json');
      if (autoJsonPath && fs.existsSync(autoJsonPath)) {
        try { autoSegments = JSON.parse(fs.readFileSync(autoJsonPath, 'utf-8')); } catch (_) {}
      }
      const autoSsContext = buildScreenshotContext(recordingId, autoSegments);
      const output = await generateWithClaude(transcriptText, autoMode, null, autoSsContext);
      db.prepare(
        'INSERT INTO artifacts (recording_id, mode, content, created_at) VALUES (?, ?, ?, ?)'
      ).run(recordingId, autoMode, output, Date.now());
      indexArtifact(recordingId, autoMode, output);
      mainWindow?.webContents.send('recordings:changed');
      auditLog('pipeline:auto-generate', recordingId, `mode=${autoMode}`);
    }
  } catch (err) {
    db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('error', recordingId);
    mainWindow?.webContents.send('recordings:changed');
    auditLog('pipeline:auto-error', recordingId, err.message);
  }
}

let currentRecordingHotkey = null;
const SCREENSHOT_HOTKEY = 'CommandOrControl+Shift+S';

function registerHotkey(accelerator) {
  if (currentRecordingHotkey) {
    try { globalShortcut.unregister(currentRecordingHotkey); } catch (_) {}
  }
  currentRecordingHotkey = null;
  if (!accelerator) return { ok: true };

  try {
    const success = globalShortcut.register(accelerator, async () => {
      if (videoProcess) {
        await doStopRecording();
      } else {
        const result = await doStartRecording();
        if (!result.ok) {
          dialog.showErrorBox('Recording failed', result.error);
        }
      }
    });
    if (!success) return { ok: false, error: `Could not register ${accelerator} — another app may have claimed it` };
    currentRecordingHotkey = accelerator;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, stream: true, supportFetchAPI: true } },
]);

app.whenReady().then(() => {
  protocol.handle('media', async (request) => {
    const parsed = new URL(request.url);
    let filePath = decodeURIComponent(parsed.pathname);
    if (filePath.startsWith('/')) filePath = filePath.slice(1);

    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(defaultRecordingsDir) && !resolved.startsWith(getRecordingsDir())) {
      auditLog('security:blocked', resolved, 'media:// path traversal attempt');
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const stat = fs.statSync(resolved);
      const ext = path.extname(resolved).toLowerCase();
      const mime = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
      const contentType = mime[ext] || 'application/octet-stream';
      const rangeHeader = request.headers.get('Range');

      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
          const chunk = end - start + 1;
          const buf = Buffer.alloc(chunk);
          const fd = fs.openSync(resolved, 'r');
          fs.readSync(fd, buf, 0, chunk, start);
          fs.closeSync(fd);
          return new Response(buf, {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Content-Length': String(chunk),
              'Accept-Ranges': 'bytes',
            },
          });
        }
      }

      const data = fs.readFileSync(resolved);
      return new Response(data, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch (fsErr) {
      return new Response('Not found', { status: 404 });
    }
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'mediaKeySystem', 'audioCapture'];
    callback(allowed.includes(permission));
  });

  migrateCredentials();
  const stale = db.prepare("SELECT id FROM recordings WHERE status = 'recording'").all();
  for (const row of stale) {
    db.prepare("UPDATE recordings SET status = 'error' WHERE id = ?").run(row.id);
    auditLog('recording:cleanup', row.id, 'stale recording row from prior crash');
  }
  enforceRetention();
  rebuildSearchIndex();

  createWindow();

  // Migrate stale hotkey defaults to the current default
  const storedHotkey = getSetting('globalHotkey', '');
  if (storedHotkey && storedHotkey !== DEFAULT_HOTKEY && ['CommandOrControl+Shift+R', 'CommandOrControl+Shift+F10'].includes(storedHotkey)) {
    setSetting('globalHotkey', '');
  }
  const hotkey = getSetting('globalHotkey', DEFAULT_HOTKEY) || DEFAULT_HOTKEY;
  const hkResult = registerHotkey(hotkey);
  if (!hkResult.ok) console.warn('Hotkey registration failed:', hkResult.error);

  auditLog('app:start', null, `v${app.getVersion()} ${process.platform} ${process.arch}`);
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (videoProcess) {
    try { videoProcess.kill(); } catch (_) {}
    videoProcess = null;
    if (activeRecordingId) {
      try {
        db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('error', activeRecordingId);
        auditLog('recording:stop', activeRecordingId, 'forced stop on app quit');
      } catch (_) {}
    }
  }
  try { db.close(); } catch (_) {}
});

// ---- IPC: Recording ----

ipcMain.handle('recording:start', async (_evt, options = {}) => {
  return doStartRecording(options);
});

ipcMain.handle('recording:stop', async () => {
  return doStopRecording();
});

ipcMain.handle('recording:status', () => ({
  isRecording: videoProcess !== null,
  id: activeRecordingId,
  startedAt: recordingStartTime,
}));

ipcMain.handle('recording:screenshot', async () => {
  return captureScreenshot();
});

// ---- IPC: Library ----

ipcMain.handle('recordings:list', () => {
  return db.prepare(`
    SELECT r.*,
           (SELECT COUNT(*) FROM artifacts a WHERE a.recording_id = r.id) AS artifact_count
    FROM recordings r
    ORDER BY created_at DESC
  `).all();
});

ipcMain.handle('recordings:search', (_evt, query) => {
  if (!query || !query.trim()) return [];
  const safeQuery = query.replace(/[^\w\s.\-]/g, ' ').trim().split(/\s+/).filter(Boolean).map((w) => `"${w}"`).join(' ');
  try {
    return db.prepare(`
      SELECT s.recording_id, s.type, snippet(search_index, 2, '→', '←', '…', 32) AS snippet
      FROM search_index s
      WHERE search_index MATCH ?
      ORDER BY rank
      LIMIT 50
    `).all(safeQuery);
  } catch (_) {
    return [];
  }
});

ipcMain.handle('recordings:get', (_evt, id) => {
  const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);
  if (!recording) return null;
  const artifacts = db.prepare(
    'SELECT * FROM artifacts WHERE recording_id = ? ORDER BY created_at DESC'
  ).all(id);
  const screenshots = db.prepare(
    'SELECT * FROM screenshots WHERE recording_id = ? ORDER BY timestamp_ms ASC'
  ).all(id);
  return { ...recording, artifacts, screenshots };
});

ipcMain.handle('recordings:delete', (_evt, id) => {
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);
  if (rec) {
    for (const f of [rec.video_path, rec.audio_path, rec.transcript_path]) {
      if (f) secureDelete(f);
    }
    const jsonPath = rec.audio_path?.replace(/\.wav$/, '.json');
    if (jsonPath) secureDelete(jsonPath);
  }
  const ssFiles = db.prepare('SELECT file_path FROM screenshots WHERE recording_id = ?').all(id);
  for (const ss of ssFiles) { if (ss.file_path) secureDelete(ss.file_path); }
  const deleteAll = db.transaction(() => {
    db.prepare('DELETE FROM screenshots WHERE recording_id = ?').run(id);
    db.prepare('DELETE FROM artifacts WHERE recording_id = ?').run(id);
    db.prepare('DELETE FROM search_index WHERE recording_id = ?').run(id);
    db.prepare('DELETE FROM profile_insights WHERE recording_id = ?').run(id);
    db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
  });
  deleteAll();
  auditLog('recording:delete', id);
  return { ok: true };
});

ipcMain.handle('recordings:update', (_evt, id, updates) => {
  const fields = [];
  const values = [];
  for (const key of ['title', 'project', 'tags']) {
    if (key in updates) { fields.push(`${key} = ?`); values.push(updates[key]); }
  }
  if (fields.length === 0) return { ok: true };
  values.push(id);
  db.prepare(`UPDATE recordings SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return { ok: true };
});

// ---- IPC: Pipeline (transcribe + generate) ----

ipcMain.handle('pipeline:transcribe', async (_evt, id) => {
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);
  if (!rec) return { ok: false, error: 'Recording not found' };

  db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('transcribing', id);
  mainWindow?.webContents.send('recordings:changed');

  try {
    const transcriptPath = await transcribeAudio(rec.audio_path);
    db.prepare('UPDATE recordings SET transcript_path = ?, status = ? WHERE id = ?')
      .run(transcriptPath, 'transcribed', id);
    mainWindow?.webContents.send('recordings:changed');

    // Auto-generate a succinct title from the transcript
    try {
      const transcript = fs.readFileSync(transcriptPath, 'utf-8');
      const newTitle = (await generateWithClaude(transcript, 'title')).trim();
      if (newTitle && newTitle.length < 100) {
        db.prepare('UPDATE recordings SET title = ? WHERE id = ?').run(newTitle, id);
        mainWindow?.webContents.send('recordings:changed');
      }
    } catch (_) {}

    const transcriptText = fs.readFileSync(transcriptPath, 'utf-8');
    indexTranscript(id, transcriptText);
    auditLog('pipeline:transcribe', id, 'success');
    if (getSetting('conceptsAutoExtract') === 'true') {
      extractInsights(id).catch(() => {});
    }
    return { ok: true, transcriptPath };
  } catch (err) {
    db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('error', id);
    mainWindow?.webContents.send('recordings:changed');
    auditLog('pipeline:transcribe', id, `error: ${err.message}`);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('pipeline:generate', async (_evt, id, mode) => {
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);
  if (!rec || !rec.transcript_path) return { ok: false, error: 'No transcript available' };

  try {
    const transcript = fs.readFileSync(rec.transcript_path, 'utf-8');

    let segments = [];
    const jsonPath = rec.audio_path?.replace(/\.wav$/, '.json');
    if (jsonPath && fs.existsSync(jsonPath)) {
      try { segments = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')); } catch (_) {}
    }

    const ssContext = mode !== 'title' ? buildScreenshotContext(id, segments) : null;
    const output = await generateWithClaude(transcript, mode, null, ssContext);
    db.prepare(
      'INSERT INTO artifacts (recording_id, mode, content, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, mode, output, Date.now());
    indexArtifact(id, mode, output);
    mainWindow?.webContents.send('recordings:changed');
    auditLog('pipeline:generate', id, `mode=${mode}${ssContext ? ` with ${ssContext.length} screenshots` : ''}`);
    return { ok: true };
  } catch (err) {
    auditLog('pipeline:generate', id, `mode=${mode} error: ${err.message}`);
    return { ok: false, error: err.message };
  }
});

// ---- IPC: Voice-to-text (short clips) ----

ipcMain.handle('pipeline:transcribeBlob', async (_evt, arrayBuf) => {
  try {
    const apiKey = getSetting('openaiApiKey');
    if (!apiKey) return { ok: false, error: 'OpenAI API key not configured. Add it in Administration.' };

    const tmpPath = path.join(app.getPath('temp'), `mnemori-voice-${Date.now()}.webm`);
    fs.writeFileSync(tmpPath, Buffer.from(arrayBuf));

    const client = new OpenAI({ apiKey });
    const result = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(tmpPath),
      response_format: 'text',
    });

    try { fs.unlinkSync(tmpPath); } catch (_) {}
    return { ok: true, text: result.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---- IPC: Settings ----

const ALLOWED_SETTINGS = new Set(['audioDevice', 'openaiApiKey', 'anthropicApiKey', 'retentionDays', 'clerkUserId', 'clerkUserRole', 'globalHotkey', 'autoTranscribe', 'autoGenerateMode', 'conceptsAutoExtract', 'storagePath', 'policyAutoPipelineDisabled', 'policyConceptsDisabled']);

// Settings that require owner or admin role to modify
const ADMIN_ONLY_SETTINGS = new Set(['openaiApiKey', 'anthropicApiKey', 'retentionDays', 'storagePath', 'policyAutoPipelineDisabled', 'policyConceptsDisabled']);

function getCurrentRole() {
  const role = getSetting('clerkUserRole', 'owner');
  if (role === 'org:admin') return 'admin';
  if (role === 'org:member') return 'member';
  return 'owner';
}

ipcMain.handle('settings:get', (_evt, key) => {
  if (!ALLOWED_SETTINGS.has(key)) return '';
  if (ENCRYPTED_KEYS.has(key)) {
    const val = getSetting(key);
    if (!val) return '';
    return val.slice(0, 7) + '…' + val.slice(-4);
  }
  return getSetting(key);
});

// settings:getDecrypted intentionally not exposed in preload — internal use only
// Raw API keys are accessed via getSetting() within the main process for transcription/generation

ipcMain.handle('settings:set', (_evt, key, value) => {
  if (!ALLOWED_SETTINGS.has(key)) {
    auditLog('security:blocked', key, 'attempted write to non-allowlisted setting');
    return { ok: false, error: 'Setting not allowed' };
  }
  if (ADMIN_ONLY_SETTINGS.has(key) && getCurrentRole() === 'member') {
    auditLog('security:blocked', key, 'member attempted to modify admin-only setting');
    return { ok: false, error: 'Insufficient permissions' };
  }
  if (key === 'retentionDays' && value) {
    const days = parseInt(value, 10);
    if (isNaN(days) || days < 0) return { ok: false, error: 'Retention days must be a non-negative number' };
    value = String(days);
  }
  if (key === 'openaiApiKey' || key === 'anthropicApiKey') {
    value = (value || '').trim();
  }
  setSetting(key, value);
  const LOGGABLE_SETTINGS = new Set(['audioDevice', 'retentionDays']);
  const safeDetail = LOGGABLE_SETTINGS.has(key) ? `value="${value}"` : '(credential updated)';
  auditLog('settings:change', key, safeDetail);
  return { ok: true };
});

ipcMain.handle('audit:list', (_evt, limit = 200) => {
  if (getCurrentRole() === 'member') {
    auditLog('security:blocked', 'audit:list', 'member attempted to view full audit log');
    return [];
  }
  const safeLimit = Math.min(Math.max(parseInt(limit) || 200, 1), 1000);
  return db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?').all(safeLimit);
});

ipcMain.handle('settings:listAudioDevices', async () => {
  if (isMac) {
    const devices = await getAvfoundationDevices();
    return devices.audio.map((d) => d.name);
  }

  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
    let output = '';
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.on('error', () => resolve([]));
    proc.on('close', () => {
      const devices = [];
      const matches = output.matchAll(/"([^"]+)"\s*\(audio\)/g);
      for (const m of matches) devices.push(m[1]);
      resolve(devices);
    });
  });
});

// ---- IPC: Projects ----

ipcMain.handle('projects:list', () => {
  return db.prepare(`
    SELECT p.*,
           (SELECT COUNT(*) FROM recordings r WHERE r.project = p.name) AS recording_count
    FROM projects p
    ORDER BY created_at DESC
  `).all();
});

ipcMain.handle('projects:create', (_evt, name, description = '') => {
  const existing = db.prepare('SELECT id FROM projects WHERE name = ?').get(name);
  if (existing) return { ok: false, error: 'A project with that name already exists' };
  const id = `proj_${Date.now()}`;
  db.prepare('INSERT INTO projects (id, name, description, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name, description, Date.now());
  return { ok: true, id };
});

ipcMain.handle('projects:delete', (_evt, id) => {
  const proj = db.prepare('SELECT name FROM projects WHERE id = ?').get(id);
  if (proj) {
    db.prepare('UPDATE recordings SET project = ? WHERE project = ?').run('', proj.name);
  }
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return { ok: true };
});

ipcMain.handle('projects:get', (_evt, id) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!project) return null;
  const recordings = db.prepare(`
    SELECT r.*,
           (SELECT COUNT(*) FROM artifacts a WHERE a.recording_id = r.id) AS artifact_count
    FROM recordings r
    WHERE r.project = ?
    ORDER BY created_at DESC
  `).all(project.name);
  return { ...project, recordings };
});

ipcMain.handle('projects:generateSummary', async (_evt, projectId) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return { ok: false, error: 'Project not found' };

  const recordings = db.prepare(`
    SELECT * FROM recordings
    WHERE project = ? AND transcript_path IS NOT NULL
    ORDER BY created_at ASC
  `).all(project.name);

  if (recordings.length === 0) {
    return { ok: false, error: 'No transcribed recordings in this project' };
  }

  let combined = '';
  for (const rec of recordings) {
    if (!rec.transcript_path || !fs.existsSync(rec.transcript_path)) continue;
    const text = fs.readFileSync(rec.transcript_path, 'utf-8');
    const date = new Date(rec.created_at).toLocaleString();
    combined += `\n--- SESSION: "${rec.title}" (${date}) ---\n${text}\n`;
  }

  if (!combined.trim()) {
    return { ok: false, error: 'No transcript content found' };
  }

  try {
    const summary = await generateWithClaude(combined, 'project_summary');
    db.prepare('UPDATE projects SET summary = ? WHERE id = ?').run(summary, projectId);
    return { ok: true, summary };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---- IPC: System ----

function isSafePath(p) {
  const resolved = path.resolve(p);
  return resolved.startsWith(userDataDir) || resolved.startsWith(defaultRecordingsDir) || resolved.startsWith(getRecordingsDir());
}

ipcMain.handle('system:openPath', (_evt, p) => {
  if (!isSafePath(p)) {
    auditLog('security:blocked', p, 'openPath outside allowed directories');
    return;
  }
  shell.openPath(p);
});

ipcMain.handle('system:showItemInFolder', (_evt, p) => {
  if (!isSafePath(p)) {
    auditLog('security:blocked', p, 'showItemInFolder outside allowed directories');
    return;
  }
  shell.showItemInFolder(p);
});

ipcMain.handle('system:copyToClipboard', (_evt, text) => {
  clipboard.writeText(text);
  return { ok: true };
});

function markdownToHtml(md) {
  function inlineFmt(t) {
    return t
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:4px;margin:8px 0;">')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:#f0ece4;padding:2px 4px;border-radius:3px;">$1</code>');
  }
  const lines = md.split('\n');
  const blocks = [];
  let cur = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (cur.length) { blocks.push(cur.join('\n')); cur = []; }
    } else { cur.push(line); }
  }
  if (cur.length) blocks.push(cur.join('\n'));
  return blocks.map(b => {
    const t = b.trim();
    if (t.startsWith('### ')) return `<h3>${inlineFmt(t.slice(4))}</h3>`;
    if (t.startsWith('## ')) return `<h2>${inlineFmt(t.slice(3))}</h2>`;
    if (t.startsWith('# ')) return `<h1>${inlineFmt(t.slice(2))}</h1>`;
    if (/^---+$/.test(t)) return '<hr>';
    if (t.match(/^\d+\. /m)) {
      const items = t.split('\n').map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean).map(l => `<li>${inlineFmt(l)}</li>`).join('');
      return `<ol>${items}</ol>`;
    }
    if (t.match(/^[-*] /m)) {
      const items = t.split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean).map(l => `<li>${inlineFmt(l)}</li>`).join('');
      return `<ul>${items}</ul>`;
    }
    if (t.startsWith('> ')) return `<blockquote style="border-left:3px solid #c9bfa9;padding-left:12px;color:#555;">${inlineFmt(t.replace(/^> ?/gm, ''))}</blockquote>`;
    return `<p>${inlineFmt(t)}</p>`;
  }).join('\n');
}

ipcMain.handle('system:copyArtifactRich', (_evt, markdownText, injectedMarkdown, screenshotMappings) => {
  let htmlSource = injectedMarkdown;
  for (const ss of screenshotMappings) {
    const resolved = path.resolve(ss.filePath);
    if (!resolved.startsWith(defaultRecordingsDir) && !resolved.startsWith(getRecordingsDir())) continue;
    if (!fs.existsSync(resolved)) continue;
    const base64 = fs.readFileSync(resolved).toString('base64');
    const mediaUrl = `media://localhost/${ss.filePath.replace(/\\/g, '/')}`;
    htmlSource = htmlSource.split(mediaUrl).join(`data:image/png;base64,${base64}`);
  }
  const html = markdownToHtml(htmlSource);
  clipboard.write({ text: markdownText, html });
  return { ok: true };
});

ipcMain.handle('system:saveFile', async (_evt, defaultName, content) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Text', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) return { ok: false, error: 'cancelled' };
  fs.writeFileSync(result.filePath, content, 'utf-8');
  auditLog('file:export', result.filePath, `${content.length} chars`);
  return { ok: true, path: result.filePath };
});

ipcMain.handle('system:saveArtifactBundle', async (_evt, defaultName, content, screenshotFiles) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) return { ok: false, error: 'Cancelled' };

  const mdPath = result.filePath;
  const baseName = path.basename(mdPath, path.extname(mdPath));
  const safeFolderName = baseName.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') + '_images';
  const imagesDir = path.join(path.dirname(mdPath), safeFolderName);
  let processedContent = content;
  let imageCount = 0;

  if (screenshotFiles && screenshotFiles.length > 0) {
    fs.mkdirSync(imagesDir, { recursive: true });

    for (const ss of screenshotFiles) {
      const resolved = path.resolve(ss.filePath);
      if (!resolved.startsWith(defaultRecordingsDir) && !resolved.startsWith(getRecordingsDir())) continue;
      if (!fs.existsSync(resolved)) continue;

      const destName = `screenshot_${ss.label.replace(':', '_')}.png`;
      fs.copyFileSync(resolved, path.join(imagesDir, destName));
      imageCount++;

      const mediaUrl = `media://localhost/${ss.filePath.replace(/\\/g, '/')}`;
      const relativePath = `${safeFolderName}/${destName}`;
      processedContent = processedContent.split(mediaUrl).join(relativePath);
    }
  }

  fs.writeFileSync(mdPath, processedContent, 'utf-8');
  auditLog('file:export', mdPath, `artifact with ${imageCount} images`);
  return { ok: true, path: mdPath, imageCount };
});

ipcMain.handle('screenshot:copy', (_evt, filePath) => {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(defaultRecordingsDir) && !resolved.startsWith(getRecordingsDir())) {
    return { ok: false, error: 'Invalid path' };
  }
  if (!fs.existsSync(resolved)) return { ok: false, error: 'File not found' };
  const img = nativeImage.createFromPath(resolved);
  clipboard.writeImage(img);
  return { ok: true };
});

ipcMain.handle('screenshot:save', async (_evt, filePath) => {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(defaultRecordingsDir) && !resolved.startsWith(getRecordingsDir())) {
    return { ok: false, error: 'Invalid path' };
  }
  if (!fs.existsSync(resolved)) return { ok: false, error: 'File not found' };
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.basename(resolved),
    filters: [{ name: 'PNG Image', extensions: ['png'] }, { name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, error: 'Cancelled' };
  fs.copyFileSync(resolved, result.filePath);
  auditLog('file:export', result.filePath, 'screenshot');
  return { ok: true };
});

// ---- Hotkey ----

ipcMain.handle('hotkey:get', () => {
  return getSetting('globalHotkey', DEFAULT_HOTKEY);
});

ipcMain.handle('hotkey:set', (_evt, accelerator) => {
  const result = registerHotkey(accelerator);
  if (result.ok) {
    setSetting('globalHotkey', accelerator);
    auditLog('settings:change', 'globalHotkey', accelerator);
  }
  return result;
});

ipcMain.handle('hotkey:clear', () => {
  if (currentRecordingHotkey) {
    try { globalShortcut.unregister(currentRecordingHotkey); } catch (_) {}
    currentRecordingHotkey = null;
  }
  setSetting('globalHotkey', '');
  auditLog('settings:change', 'globalHotkey', '(disabled)');
  return { ok: true };
});

// ---- IPC: Concepts / Profile ----

const ALLOWED_PROFILE_KEYS = new Set(['name', 'role', 'goals', 'challenges', 'confidence', 'freeform', 'conceptsOptedIn']);
ipcMain.handle('profile:get', (_evt, key) => getProfile(key));
ipcMain.handle('profile:set', (_evt, key, value) => {
  if (!ALLOWED_PROFILE_KEYS.has(key)) {
    auditLog('security:blocked', key, 'attempted write to non-allowlisted profile key');
    return { ok: false, error: 'Profile key not allowed' };
  }
  setProfile(key, value);
  return { ok: true };
});
ipcMain.handle('profile:getAll', () => getAllProfile());
ipcMain.handle('profile:isComplete', () => isProfileComplete());

ipcMain.handle('concepts:insights', () => {
  return db.prepare('SELECT * FROM profile_insights ORDER BY created_at DESC').all();
});

ipcMain.handle('concepts:extract', async (_evt, recordingId) => {
  if (getSetting('policyConceptsDisabled') === 'true') {
    return { ok: false, error: 'Concepts has been disabled by your organization.' };
  }
  try {
    await extractInsights(recordingId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('concepts:backfill', async () => {
  const recordings = db.prepare(`
    SELECT id FROM recordings
    WHERE transcript_path IS NOT NULL AND status = 'transcribed'
    AND id NOT IN (SELECT recording_id FROM profile_insights)
    ORDER BY created_at DESC LIMIT 50
  `).all();

  let count = 0;
  for (const rec of recordings) {
    try {
      await extractInsights(rec.id);
      count++;
      mainWindow?.webContents.send('recordings:changed');
    } catch (_) {}
  }
  return { ok: true, count };
});

ipcMain.handle('concepts:generateReadout', async () => {
  if (getSetting('policyConceptsDisabled') === 'true') {
    return { ok: false, error: 'Concepts has been disabled by your organization.' };
  }
  const profile = getAllProfile();
  if (!profile.name && !profile.role && !profile.goals) {
    return { ok: false, error: 'Complete your profile first' };
  }

  const insights = db.prepare('SELECT * FROM profile_insights ORDER BY created_at DESC LIMIT 50').all();
  if (insights.length === 0) {
    return { ok: false, error: 'No session data yet. Transcribe recordings with insight extraction enabled.' };
  }

  const profileText = Object.entries(profile).map(([k, v]) => `${k}: ${v}`).join('\n');

  const sessionData = insights.map((ins) => {
    const rec = db.prepare('SELECT title, created_at FROM recordings WHERE id = ?').get(ins.recording_id);
    return {
      session: rec?.title || ins.recording_id,
      date: rec ? new Date(rec.created_at).toLocaleDateString() : 'unknown',
      filler_count: ins.filler_count,
      self_corrections: ins.self_corrections,
      hedging_count: ins.hedging_count,
      confidence_score: ins.confidence_score,
      topics: JSON.parse(ins.topics || '[]'),
      strengths: JSON.parse(ins.strengths || '[]'),
      growth_edges: JSON.parse(ins.growth_edges || '[]'),
    };
  });

  const prompt = COACHING_READOUT_PROMPT
    .replace('{profile}', profileText)
    .replace('{data}', JSON.stringify(sessionData, null, 2));

  try {
    const content = await generateWithClaude('', null, prompt);
    db.prepare('INSERT INTO coaching_readouts (created_at, content, recording_count) VALUES (?, ?, ?)')
      .run(Date.now(), content, insights.length);
    auditLog('concepts:readout', null, `from ${insights.length} sessions`);
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('concepts:readouts', () => {
  return db.prepare('SELECT * FROM coaching_readouts ORDER BY created_at DESC').all();
});

// ---- IPC: Goals ----

ipcMain.handle('goals:list', () => {
  const goals = db.prepare('SELECT * FROM goals ORDER BY created_at DESC').all();
  return goals.map((g) => ({
    ...g,
    milestones: db.prepare('SELECT * FROM milestones WHERE goal_id = ? ORDER BY created_at DESC').all(g.id),
  }));
});

ipcMain.handle('goals:create', (_evt, label, metric, direction) => {
  const result = db.prepare('INSERT INTO goals (label, metric, direction, created_at) VALUES (?, ?, ?, ?)').run(label, metric, direction, Date.now());
  return { ok: true, id: result.lastInsertRowid };
});

ipcMain.handle('goals:delete', (_evt, id) => {
  db.prepare('DELETE FROM milestones WHERE goal_id = ?').run(id);
  db.prepare('DELETE FROM goals WHERE id = ?').run(id);
  return { ok: true };
});

const GOAL_METRIC_COLUMNS = {
  filler_count: 'filler_count',
  self_corrections: 'self_corrections',
  hedging_count: 'hedging_count',
  confidence_score: 'confidence_score',
};

ipcMain.handle('goals:history', (_evt, metric) => {
  const col = GOAL_METRIC_COLUMNS[metric];
  if (!col) return [];
  const rows = db.prepare(`
    SELECT pi.${col} as value, pi.created_at, r.title
    FROM profile_insights pi
    JOIN recordings r ON r.id = pi.recording_id
    ORDER BY pi.created_at ASC
  `).all();
  return rows;
});

ipcMain.handle('goals:checkMilestones', () => {
  const goals = db.prepare('SELECT * FROM goals WHERE achieved_at IS NULL').all();
  const insights = db.prepare('SELECT * FROM profile_insights ORDER BY created_at ASC').all();
  if (insights.length < 3) return { awarded: [] };

  const awarded = [];

  for (const goal of goals) {
    const existing = db.prepare('SELECT label FROM milestones WHERE goal_id = ?').all(goal.id).map((m) => m.label);
    const values = insights.map((i) => i[goal.metric]);
    const recent = values.slice(-5);
    const early = values.slice(0, Math.min(5, Math.floor(values.length / 2)));
    if (recent.length < 3 || early.length < 2) continue;

    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
    const avgEarly = early.reduce((a, b) => a + b, 0) / early.length;
    const improving = goal.direction === 'decrease' ? avgRecent < avgEarly : avgRecent > avgEarly;

    if (improving && !existing.includes('Trending')) {
      const pct = Math.abs(Math.round(((avgRecent - avgEarly) / (avgEarly || 1)) * 100));
      const detail = `${pct}% ${goal.direction === 'decrease' ? 'reduction' : 'improvement'} over ${values.length} sessions`;
      db.prepare('INSERT INTO milestones (goal_id, label, detail, created_at) VALUES (?, ?, ?, ?)').run(goal.id, 'Trending', detail, Date.now());
      awarded.push({ goalLabel: goal.label, milestone: 'Trending', detail });
    }

    const streakLen = 3;
    if (values.length >= streakLen + 1 && !existing.includes('Streak')) {
      const tail = values.slice(-streakLen);
      const prev = values.slice(-(streakLen + 1), -1);
      const allBetter = tail.every((v, i) =>
        goal.direction === 'decrease' ? v <= prev[i] : v >= prev[i]
      );
      if (allBetter) {
        db.prepare('INSERT INTO milestones (goal_id, label, detail, created_at) VALUES (?, ?, ?, ?)').run(goal.id, 'Streak', `${streakLen} sessions of consecutive improvement`, Date.now());
        awarded.push({ goalLabel: goal.label, milestone: 'Streak', detail: `${streakLen} sessions in a row` });
      }
    }

    if (goal.direction === 'decrease' && avgRecent === 0 && values.length >= 5 && !existing.includes('Mastered')) {
      db.prepare('UPDATE goals SET achieved_at = ? WHERE id = ?').run(Date.now(), goal.id);
      db.prepare('INSERT INTO milestones (goal_id, label, detail, created_at) VALUES (?, ?, ?, ?)').run(goal.id, 'Mastered', `Reached zero across recent sessions`, Date.now());
      awarded.push({ goalLabel: goal.label, milestone: 'Mastered', detail: 'Goal achieved' });
    }

    if (goal.direction === 'increase' && goal.metric === 'confidence_score' && avgRecent >= 0.85 && values.length >= 5 && !existing.includes('Mastered')) {
      db.prepare('UPDATE goals SET achieved_at = ? WHERE id = ?').run(Date.now(), goal.id);
      db.prepare('INSERT INTO milestones (goal_id, label, detail, created_at) VALUES (?, ?, ?, ?)').run(goal.id, 'Mastered', `Confidence consistently above 85%`, Date.now());
      awarded.push({ goalLabel: goal.label, milestone: 'Mastered', detail: 'Goal achieved' });
    }
  }

  return { awarded };
});

// ---- IPC: Storage path ----

ipcMain.handle('settings:getStoragePath', () => {
  const custom = getSetting('storagePath');
  return {
    current: getRecordingsDir(),
    isDefault: !custom,
    defaultPath: defaultRecordingsDir,
  };
});

ipcMain.handle('settings:chooseStoragePath', async () => {
  const role = getCurrentRole();
  if (role === 'member') return { ok: false, error: 'Insufficient permissions' };

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose storage directory',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: getRecordingsDir(),
  });

  if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'Cancelled' };
  const chosen = result.filePaths[0];

  try {
    const testFile = path.join(chosen, '.mnemori-write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
  } catch (_) {
    return { ok: false, error: 'Directory is not writable' };
  }

  return { ok: true, path: chosen };
});

ipcMain.handle('settings:setStoragePath', (_evt, newPath) => {
  const role = getCurrentRole();
  if (role === 'member') return { ok: false, error: 'Insufficient permissions' };

  if (!newPath) {
    setSetting('storagePath', '');
    auditLog('settings:storagePath', null, 'reset to default');
    return { ok: true };
  }

  if (!fs.existsSync(newPath)) {
    try { fs.mkdirSync(newPath, { recursive: true }); } catch (_) {
      return { ok: false, error: 'Could not create directory' };
    }
  }

  setSetting('storagePath', newPath);
  auditLog('settings:storagePath', null, `changed to ${newPath}`);
  return { ok: true };
});

// ---- Auth (browser-based Clerk sign-in) ----

ipcMain.handle('auth:sign-in', () => {
  return new Promise((resolve) => {
    const authWin = new BrowserWindow({
      width: 480,
      height: 680,
      parent: mainWindow,
      modal: true,
      title: 'Sign in — Mnemori',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    authWin.setMenuBarVisibility(false);
    authWin.loadURL('https://mnemori.app/auth.html');

    const poll = setInterval(async () => {
      if (authWin.isDestroyed()) return;
      try {
        const raw = await authWin.webContents.executeJavaScript(
          'window.__mnemoriUser ? JSON.stringify(window.__mnemoriUser) : null'
        );
        if (raw) {
          clearInterval(poll);
          const user = JSON.parse(raw);
          setSetting('clerkUserId', user.id);
          setSetting('clerkUserRole', user.role || 'owner');
          auditLog('auth:sign-in', user.id, user.email);
          if (!authWin.isDestroyed()) authWin.close();
          resolve({ ok: true, user });
        }
      } catch (_) {}
    }, 500);

    authWin.on('closed', () => {
      clearInterval(poll);
      resolve({ ok: false, error: 'cancelled' });
    });
  });
});

ipcMain.handle('auth:sign-out', () => {
  setSetting('clerkUserId', '');
  setSetting('clerkUserRole', 'owner');
  auditLog('auth:sign-out', null);
  return { ok: true };
});
