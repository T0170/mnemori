import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from '../lib/toast';
import { formatDuration, formatRelativeTime, statusLabel } from '../lib/format';
import Markdown from '../components/Markdown';

const MODES = [
  { id: 'sop', label: 'SOP' },
  { id: 'methodology', label: 'Methodology' },
  { id: 'coaching', label: 'Coaching review' },
  { id: 'notes', label: 'Cleaned notes' },
];

export default function RecordingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [recording, setRecording] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', project: '', tags: '' });
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    load();
    loadProjects();
    const unsub = window.api.recordings.onChanged(load);
    return unsub;
  }, [id]);

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
      } catch (_) { /* ignore */ }
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

  async function deleteRecording() {
    if (!confirm('Delete this recording and all its artifacts? This cannot be undone.')) return;
    await window.api.recordings.remove(id);
    toast('Deleted');
    navigate('/');
  }

  if (!recording) return null;

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
                <video controls src={`media://localhost/${recording.video_path.replace(/\\/g, '/')}`} />
              ) : (
                <div className="video-placeholder">No video</div>
              )}
            </div>

            {transcript && (
              <>
                <div className="section-heading">
                  <span>Transcript</span>
                </div>
                <div className="transcript-box">{transcript}</div>
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
                      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        {formatRelativeTime(a.created_at)}
                      </div>
                    </div>
                    <div className="artifact-content"><Markdown>{a.content}</Markdown></div>
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
    </>
  );
}
