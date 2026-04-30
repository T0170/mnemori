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

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const Database = require('better-sqlite3');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');

const isDev = !app.isPackaged;
const isMac = process.platform === 'darwin';

// ---- Paths ----
const userDataDir = app.getPath('userData');
const recordingsDir = path.join(userDataDir, 'recordings');
const dbPath = path.join(userDataDir, 'mnemori.db');

if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

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
`);

try { db.exec('ALTER TABLE projects ADD COLUMN summary TEXT DEFAULT ""'); } catch (_) {}

// ---- Recording state ----
let mainWindow = null;
let videoProcess = null;
let activeRecordingId = null;
let recordingStartTime = null;

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
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

// ---- API helpers ----

async function transcribeAudio(wavPath) {
  const apiKey = getSetting('openaiApiKey');
  if (!apiKey) throw new Error('OpenAI API key not configured. Open Settings.');

  const client = new OpenAI({ apiKey });
  const result = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file: fs.createReadStream(wavPath),
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  });

  const txtPath = wavPath.replace(/\.wav$/, '.txt');
  fs.writeFileSync(txtPath, result.text, 'utf-8');

  const jsonPath = wavPath.replace(/\.wav$/, '.json');
  const segments = (result.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text }));
  fs.writeFileSync(jsonPath, JSON.stringify(segments, null, 2), 'utf-8');

  return txtPath;
}

async function generateWithClaude(text, mode) {
  const apiKey = getSetting('anthropicApiKey');
  if (!apiKey) throw new Error('Anthropic API key not configured. Open Settings.');

  const prompt = PROMPTS[mode];
  if (!prompt) throw new Error(`Unknown generation mode: ${mode}`);

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: mode === 'title' ? 100 : 8000,
    messages: [{ role: 'user', content: prompt.replace('{transcript}', text) }],
  });

  return response.content[0].text;
}

// ---- Window ----

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0f0e0c',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, stream: true, bypassCSP: true, supportFetchAPI: true } },
]);

app.whenReady().then(() => {
  protocol.handle('media', async (request) => {
    const parsed = new URL(request.url);
    let filePath = decodeURIComponent(parsed.pathname);
    if (filePath.startsWith('/')) filePath = filePath.slice(1);

    try {
      return await net.fetch(pathToFileURL(filePath).href);
    } catch (_) {
      try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mime = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };
        return new Response(data, {
          headers: { 'Content-Type': mime[ext] || 'application/octet-stream' },
        });
      } catch (fsErr) {
        return new Response('Not found', { status: 404 });
      }
    }
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'mediaKeySystem', 'audioCapture'];
    callback(allowed.includes(permission));
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

// ---- IPC: Recording ----

ipcMain.handle('recording:start', async (_evt, options = {}) => {
  if (videoProcess) return { ok: false, error: 'Already recording' };

  const audioDevice = options.audioDevice || getSetting('audioDevice');
  if (!audioDevice) {
    return { ok: false, error: 'No audio device configured. Open Settings.' };
  }

  const id = `rec_${Date.now()}`;
  const basePath = path.join(recordingsDir, id);
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
      '-f', 'avfoundation',
      '-framerate', '15',
      '-capture_cursor', '1',
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
  videoProcess.on('error', () => {});

  activeRecordingId = id;
  recordingStartTime = Date.now();

  const title = options.title || new Date().toLocaleString();
  db.prepare(`
    INSERT INTO recordings (id, title, created_at, video_path, audio_path, project, tags, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'recording')
  `).run(id, title, recordingStartTime, videoPath, audioPath, options.project || '', options.tags || '');

  return { ok: true, id };
});

ipcMain.handle('recording:stop', async () => {
  if (!videoProcess) return { ok: false, error: 'Not recording' };

  const id = activeRecordingId;
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);

  try { videoProcess.stdin.write('q'); } catch (_) { /* ignore */ }

  await new Promise((resolve) => {
    videoProcess.on('close', resolve);
    setTimeout(() => {
      try { videoProcess.kill(); } catch (_) {}
      resolve();
    }, 8000);
  });

  videoProcess = null;

  // Extract audio from the MP4 into a transcription-friendly WAV
  if (rec && rec.video_path && fs.existsSync(rec.video_path)) {
    await new Promise((resolve) => {
      const extract = spawn(FFMPEG, [
        '-y', '-i', rec.video_path,
        '-vn', '-ac', '1', '-ar', '16000',
        rec.audio_path,
      ]);
      extract.on('error', () => resolve());
      extract.on('close', () => resolve());
    });
  }

  const duration = Math.round((Date.now() - recordingStartTime) / 1000);
  db.prepare('UPDATE recordings SET duration_seconds = ?, status = ? WHERE id = ?')
    .run(duration, 'recorded', id);

  activeRecordingId = null;
  recordingStartTime = null;

  return { ok: true, id };
});

ipcMain.handle('recording:status', () => ({
  isRecording: videoProcess !== null,
  id: activeRecordingId,
  startedAt: recordingStartTime,
}));

// ---- IPC: Library ----

ipcMain.handle('recordings:list', () => {
  return db.prepare(`
    SELECT r.*,
           (SELECT COUNT(*) FROM artifacts a WHERE a.recording_id = r.id) AS artifact_count
    FROM recordings r
    ORDER BY created_at DESC
  `).all();
});

ipcMain.handle('recordings:get', (_evt, id) => {
  const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);
  if (!recording) return null;
  const artifacts = db.prepare(
    'SELECT * FROM artifacts WHERE recording_id = ? ORDER BY created_at DESC'
  ).all(id);
  return { ...recording, artifacts };
});

ipcMain.handle('recordings:delete', (_evt, id) => {
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);
  if (rec) {
    for (const f of [rec.video_path, rec.audio_path, rec.transcript_path]) {
      if (f && fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch (_) {}
      }
    }
  }
  db.prepare('DELETE FROM artifacts WHERE recording_id = ?').run(id);
  db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
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

    return { ok: true, transcriptPath };
  } catch (err) {
    db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('error', id);
    mainWindow?.webContents.send('recordings:changed');
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('pipeline:generate', async (_evt, id, mode) => {
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);
  if (!rec || !rec.transcript_path) return { ok: false, error: 'No transcript available' };

  try {
    const transcript = fs.readFileSync(rec.transcript_path, 'utf-8');
    const output = await generateWithClaude(transcript, mode);
    db.prepare(
      'INSERT INTO artifacts (recording_id, mode, content, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, mode, output, Date.now());
    mainWindow?.webContents.send('recordings:changed');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---- IPC: Settings ----

ipcMain.handle('settings:get', (_evt, key) => getSetting(key));
ipcMain.handle('settings:set', (_evt, key, value) => { setSetting(key, value); return { ok: true }; });

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

ipcMain.handle('system:openPath', (_evt, p) => shell.openPath(p));
ipcMain.handle('system:showItemInFolder', (_evt, p) => shell.showItemInFolder(p));
