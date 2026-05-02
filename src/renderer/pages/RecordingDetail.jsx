import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from '../lib/toast';
import { useConfirm } from '../lib/confirm';
import { formatDuration, formatRelativeTime, statusLabel, stripMarkdown } from '../lib/format';
import Markdown from '../components/Markdown';

const MODES = [
  { id: 'sop', label: 'SOP' },
  { id: 'methodology', label: 'Methodology' },
  { id: 'coaching', label: 'Coaching review' },
  { id: 'notes', label: 'Cleaned notes' },
];

function formatTimestamp(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export default function RecordingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [recording, setRecording] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [segments, setSegments] = useState([]);
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', project: '', tags: '' });
  const [projects, setProjects] = useState([]);
  const [activeSegment, setActiveSegment] = useState(-1);
  const [showGallery, setShowGallery] = useState(false);

  const videoRef = useRef(null);
  const transcriptRef = useRef(null);
  const userScrolledRef = useRef(false);
  const scrollTimeoutRef = useRef(null);

  useEffect(() => {
    load();
    loadProjects();
    const unsub = window.api.recordings.onChanged(load);
    return unsub;
  }, [id]);

  useEffect(() => {
    if (!showGallery) return;
    const handler = (e) => { if (e.key === 'Escape') setShowGallery(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showGallery]);

  async function loadProjects() {
    const list = await window.api.projects.list();
    setProjects(list);
  }

  async function load() {
    const data = await window.api.recordings.get(id);
    if (!data) {
      navigate('/');
      return;
    }
    setRecording(data);
    setDraft({ title: data.title, project: data.project || '', tags: data.tags || '' });

    if (data.transcript_path) {
      try {
        const res = await fetch(`media://localhost/${data.transcript_path.replace(/\\/g, '/')}`);
        if (res.ok) setTranscript(await res.text());
      } catch (_) {}

      // Load segments JSON
      const jsonPath = data.audio_path?.replace(/\.wav$/, '.json');
      if (jsonPath) {
        try {
          const res = await fetch(`media://localhost/${jsonPath.replace(/\\/g, '/')}`);
          if (res.ok) setSegments(await res.json());
        } catch (_) {}
      }
    }
  }

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current || segments.length === 0) return;
    const t = videoRef.current.currentTime;
    const idx = segments.findIndex((s) => t >= s.start && t < s.end);
    setActiveSegment(idx);

    if (idx >= 0 && !userScrolledRef.current && transcriptRef.current) {
      const el = transcriptRef.current.querySelector(`[data-seg="${idx}"]`);
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [segments]);

  const handleTranscriptScroll = useCallback(() => {
    userScrolledRef.current = true;
    clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      userScrolledRef.current = false;
    }, 4000);
  }, []);

  function seekTo(start) {
    if (videoRef.current) {
      videoRef.current.currentTime = start;
      videoRef.current.play();
      userScrolledRef.current = false;
    }
  }

  async function transcribe() {
    setBusy('transcribe');
    const result = await window.api.pipeline.transcribe(id);
    setBusy(null);
    if (result.ok) toast('Transcription complete');
    else toast(result.error, 'error');
  }

  async function generate(mode) {
    setBusy(mode);
    const result = await window.api.pipeline.generate(id, mode);
    setBusy(null);
    if (result.ok) toast(`${mode} generated`);
    else toast(result.error, 'error');
  }

  async function saveEdits() {
    await window.api.recordings.update(id, draft);
    setEditing(false);
    toast('Saved');
    load();
  }

  async function copyText(text, label) {
    await window.api.system.copyToClipboard(text);
    toast(`${label} copied`);
  }

  async function copyArtifact(content, mode) {
    if (screenshots.length === 0) {
      await window.api.system.copyToClipboard(content);
      toast(`${mode} copied`);
      return;
    }
    const injected = injectScreenshotImages(content);
    const ssFiles = screenshots.map(ss => ({
      filePath: ss.file_path,
      label: formatTimestamp(ss.timestamp_ms / 1000),
    }));
    const result = await window.api.system.copyArtifactRich(content, injected, ssFiles);
    if (result.ok) toast(`${mode} copied with images`);
  }

  async function saveFile(defaultName, content) {
    const result = await window.api.system.saveFile(defaultName, content);
    if (result.ok) toast('File saved');
  }

  function safeName() {
    return (recording?.title || 'recording').replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
  }

  async function saveArtifact(mode, content) {
    const name = `${safeName()} — ${mode}.md`;
    if (screenshots.length === 0) {
      const result = await window.api.system.saveFile(name, content);
      if (result.ok) toast('File saved');
      return;
    }
    const injected = injectScreenshotImages(content);
    const ssFiles = screenshots.map(ss => ({
      filePath: ss.file_path,
      label: formatTimestamp(ss.timestamp_ms / 1000),
    }));
    const result = await window.api.system.saveArtifactBundle(name, injected, ssFiles);
    if (result.ok) {
      toast(result.imageCount > 0 ? `Saved with ${result.imageCount} image${result.imageCount === 1 ? '' : 's'}` : 'File saved');
    }
  }

  async function copyScreenshot(filePath, e) {
    e.stopPropagation();
    const result = await window.api.system.copyScreenshot(filePath);
    if (result.ok) toast('Screenshot copied');
    else toast(result.error, 'error');
  }

  async function saveScreenshot(filePath, e) {
    e.stopPropagation();
    const result = await window.api.system.saveScreenshot(filePath);
    if (result.ok) toast('Screenshot saved');
  }

  async function deleteRecording() {
    const ok = await confirm('Delete this recording and all its artifacts? This cannot be undone.');
    if (!ok) return;
    await window.api.recordings.remove(id);
    toast('Deleted');
    navigate('/');
  }

  const screenshots = recording?.screenshots || [];
  const hasSegments = segments.length > 0;

  const injectScreenshotImages = useCallback((content) => {
    if (screenshots.length === 0) return content;
    const used = new Set();
    return content.replace(/(\*{0,2})Screenshot at (\d+:\d{2})(\*{0,2})/g, (match, pre, timestamp, post) => {
      const [min, sec] = timestamp.split(':').map(Number);
      const targetMs = (min * 60 + sec) * 1000;
      const ss = screenshots.find(s => !used.has(s.id) && Math.abs(s.timestamp_ms - targetMs) < 3000);
      if (ss && ss.file_path) {
        used.add(ss.id);
        const url = `media://localhost/${ss.file_path.replace(/\\/g, '/')}`;
        return `${pre}Screenshot at ${timestamp}${post}\n\n![Screenshot at ${timestamp}](${url})\n`;
      }
      return match;
    });
  }, [screenshots]);

  const getScreenshotContext = useCallback((ss) => {
    const tSec = ss.timestamp_ms / 1000;
    if (segments.length === 0) return null;
    const nearby = segments.filter(s => Math.abs(s.start - tSec) < 15 || (s.start <= tSec && s.end >= tSec));
    if (nearby.length > 0) return nearby.map(s => s.text.trim()).join(' ');
    const closest = segments.reduce((best, s) => Math.abs(s.start - tSec) < Math.abs(best.start - tSec) ? s : best);
    return closest.text.trim();
  }, [segments]);

  const timeline = useMemo(() => {
    if (!hasSegments || !recording) return null;
    const items = [];
    segments.forEach((seg, i) => items.push({ type: 'segment', ...seg, index: i }));
    screenshots.forEach((ss) => items.push({ type: 'screenshot', ...ss, start: ss.timestamp_ms / 1000 }));
    items.sort((a, b) => a.start - b.start);
    return items;
  }, [segments, screenshots, hasSegments, recording]);

  if (!recording) return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ink-4)' }}>Loading...</div>
  );

  const canTranscribe = recording.status === 'recorded' || recording.status === 'error';
  const canGenerate = recording.status === 'transcribed' || recording.transcript_path;

  return (
    <>
      <div className="topbar">
        <div className="page-title">
          {editing ? (
            <input
              className="input"
              style={{ fontFamily: 'var(--font-display)', fontSize: 24, padding: 4 }}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              autoFocus
            />
          ) : (
            recording.title
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            ← Library
          </button>
          {editing ? (
            <button className="btn btn-primary btn-sm" onClick={saveEdits}>Save</button>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>
          )}
        </div>
      </div>

      <div className="content">
        <div className="detail">
          <div className="detail-main">
            <div className="video-container">
              {recording.video_path ? (
                <video
                  ref={videoRef}
                  controls
                  src={`media://localhost/${recording.video_path.replace(/\\/g, '/')}`}
                  onTimeUpdate={handleTimeUpdate}
                />
              ) : (
                <div className="video-placeholder">No video</div>
              )}
            </div>

            {busy && (
              <div className="pipeline-progress">
                <div className="pipeline-progress-bar" />
                <span className="pipeline-progress-label">
                  {busy === 'transcribe'
                    ? 'Transcribing audio — this may take a moment for longer recordings…'
                    : `Generating ${busy}…`}
                </span>
              </div>
            )}

            {transcript && (
              <>
                <div className="section-heading">
                  <span>Transcript</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => copyText(transcript, 'Transcript')}>
                      Copy
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => saveFile(`${safeName()} — transcript.txt`, transcript)}>
                      Save .txt
                    </button>
                  </div>
                </div>
                {hasSegments && timeline ? (
                  <div
                    className="transcript-box transcript-segments"
                    ref={transcriptRef}
                    onScroll={handleTranscriptScroll}
                  >
                    {timeline.map((item, i) =>
                      item.type === 'segment' ? (
                        <span
                          key={`seg-${item.index}`}
                          data-seg={item.index}
                          className={`transcript-seg${activeSegment === item.index ? ' transcript-seg-active' : ''}`}
                          onClick={() => seekTo(item.start)}
                          title={`${formatTimestamp(item.start)} – ${formatTimestamp(item.end)}`}
                        >
                          <span className="transcript-seg-time">{formatTimestamp(item.start)}</span>
                          {item.text}
                        </span>
                      ) : (
                        <div
                          key={`ss-${item.id}`}
                          className="transcript-screenshot"
                          onClick={() => seekTo(item.start)}
                        >
                          <img
                            src={`media://localhost/${item.file_path.replace(/\\/g, '/')}`}
                            alt={`Screenshot at ${formatTimestamp(item.start)}`}
                            className="transcript-screenshot-img"
                          />
                          <span className="transcript-screenshot-time">{formatTimestamp(item.start)}</span>
                          <div className="screenshot-actions">
                            <button className="btn btn-ghost btn-sm" onClick={(e) => copyScreenshot(item.file_path, e)}>Copy</button>
                            <button className="btn btn-ghost btn-sm" onClick={(e) => saveScreenshot(item.file_path, e)}>Save</button>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                ) : (
                  <div className="transcript-box">
                    {transcript}
                    {screenshots.length > 0 && (
                      <div style={{ marginTop: 16 }}>
                        {screenshots.map((ss) => (
                          <div key={ss.id} className="transcript-screenshot" onClick={() => seekTo(ss.timestamp_ms / 1000)}>
                            <img
                              src={`media://localhost/${ss.file_path.replace(/\\/g, '/')}`}
                              alt={`Screenshot at ${formatTimestamp(ss.timestamp_ms / 1000)}`}
                              className="transcript-screenshot-img"
                            />
                            <span className="transcript-screenshot-time">{formatTimestamp(ss.timestamp_ms / 1000)}</span>
                            <div className="screenshot-actions">
                              <button className="btn btn-ghost btn-sm" onClick={(e) => copyScreenshot(ss.file_path, e)}>Copy</button>
                              <button className="btn btn-ghost btn-sm" onClick={(e) => saveScreenshot(ss.file_path, e)}>Save</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {recording.artifacts?.length > 0 && (
              <>
                <div className="section-heading" style={{ marginTop: 32 }}>
                  <span>Generated <em>artifacts</em></span>
                </div>
                {recording.artifacts.map((a) => (
                  <div key={a.id} className="artifact">
                    <div className="artifact-head">
                      <div className="artifact-mode">{a.mode}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => copyArtifact(a.content, a.mode)}>
                          Copy
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => copyText(stripMarkdown(a.content), a.mode)}>
                          Copy plain
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => saveArtifact(a.mode, a.content)}>
                          Save .md
                        </button>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                          {formatRelativeTime(a.created_at)}
                        </div>
                      </div>
                    </div>
                    <div className="artifact-content"><Markdown screenshots={screenshots}>{injectScreenshotImages(a.content)}</Markdown></div>
                  </div>
                ))}
              </>
            )}
          </div>

          <aside className="detail-side">
            <div className="panel-section">
              <div className="panel-label">Status</div>
              <span className={`status-pill status-${recording.status}`}>
                {statusLabel(recording.status)}
              </span>
            </div>

            <div className="panel-section">
              <div className="panel-label">Recorded</div>
              <div className="panel-value">{formatRelativeTime(recording.created_at)}</div>
              <div className="panel-value" style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 2 }}>
                {formatDuration(recording.duration_seconds)} long
              </div>
            </div>

            {editing ? (
              <>
                <div className="panel-section">
                  <div className="panel-label">Project</div>
                  <select
                    className="select"
                    value={draft.project}
                    onChange={(e) => setDraft({ ...draft, project: e.target.value })}
                  >
                    <option value="">— none —</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="panel-section">
                  <div className="panel-label">Tags</div>
                  <input
                    className="input"
                    value={draft.tags}
                    onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                    placeholder="comma, separated"
                  />
                </div>
              </>
            ) : (
              <>
                {recording.project && (
                  <div className="panel-section">
                    <div className="panel-label">Project</div>
                    <div className="panel-value">{recording.project}</div>
                  </div>
                )}
                {recording.tags && (
                  <div className="panel-section">
                    <div className="panel-label">Tags</div>
                    <div className="panel-value">
                      {recording.tags.split(',').map((t) => (
                        <span key={t} className="tag" style={{ marginRight: 4 }}>{t.trim()}</span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="panel-section">
              <div className="panel-label">Pipeline</div>
              <button
                className="btn btn-primary btn-block"
                disabled={!canTranscribe || busy}
                onClick={transcribe}
                style={{ marginBottom: 8 }}
              >
                {busy === 'transcribe' ? 'Transcribing…' : 'Transcribe audio'}
              </button>
              <div className="gen-chips">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    className="gen-chip"
                    disabled={!canGenerate || busy}
                    onClick={() => generate(m.id)}
                  >
                    {busy === m.id ? `${m.label}…` : `+ ${m.label}`}
                  </button>
                ))}
              </div>
            </div>

            {screenshots.length > 0 && (
              <div className="panel-section">
                <div className="panel-label">Screenshots</div>
                <button
                  className="btn btn-ghost btn-sm btn-block"
                  onClick={() => setShowGallery(true)}
                >
                  {screenshots.length} capture{screenshots.length === 1 ? '' : 's'}
                </button>
              </div>
            )}

            <div className="panel-section">
              <div className="panel-label">File</div>
              <button
                className="btn btn-ghost btn-sm btn-block"
                onClick={() => window.api.system.showItemInFolder(recording.video_path)}
                style={{ marginBottom: 6 }}
              >
                Show in folder
              </button>
              <button
                className="btn btn-danger btn-sm btn-block"
                onClick={deleteRecording}
              >
                Delete recording
              </button>
            </div>
          </aside>
        </div>
      </div>

      {showGallery && (
        <div className="gallery-overlay" onClick={() => setShowGallery(false)} role="dialog" aria-modal="true" aria-label="Screenshot gallery">
          <div className="gallery-container" onClick={e => e.stopPropagation()}>
            <div className="gallery-header">
              <h3>Captures</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowGallery(false)} aria-label="Close gallery">Close</button>
            </div>
            <div className="gallery-grid">
              {screenshots.map(ss => {
                const context = getScreenshotContext(ss);
                return (
                  <div key={ss.id} className="gallery-item">
                    <div className="gallery-img-wrap" onClick={() => { seekTo(ss.timestamp_ms / 1000); setShowGallery(false); }}>
                      <img
                        src={`media://localhost/${ss.file_path.replace(/\\/g, '/')}`}
                        alt={`Screenshot at ${formatTimestamp(ss.timestamp_ms / 1000)}`}
                        className="gallery-img"
                      />
                    </div>
                    <div className="gallery-meta">
                      <div className="gallery-meta-top">
                        <span className="gallery-time">{formatTimestamp(ss.timestamp_ms / 1000)}</span>
                        <div className="gallery-actions">
                          <button className="btn btn-ghost btn-sm" onClick={(e) => copyScreenshot(ss.file_path, e)}>Copy</button>
                          <button className="btn btn-ghost btn-sm" onClick={(e) => saveScreenshot(ss.file_path, e)}>Save</button>
                        </div>
                      </div>
                      {context && <p className="gallery-context">{context}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
