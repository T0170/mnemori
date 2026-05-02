import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from '../lib/toast';
import { useConfirm } from '../lib/confirm';
import { formatDuration, formatRelativeTime, statusLabel, stripMarkdown } from '../lib/format';
import Markdown from '../components/Markdown';

export default function Projects() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [projects, setProjects] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => { loadProjects(); }, []);
  useEffect(() => { if (id) loadDetail(id); else setDetail(null); }, [id]);

  async function loadProjects() {
    try {
      const list = await window.api.projects.list();
      setProjects(list);
    } catch (err) {
      toast('Failed to load projects', 'error');
    }
    setLoading(false);
  }

  async function loadDetail(projId) {
    try {
      const data = await window.api.projects.get(projId);
      setDetail(data);
    } catch (err) {
      toast('Failed to load project', 'error');
    }
  }

  async function createProject() {
    const name = newName.trim();
    if (!name) return;
    try {
      await window.api.projects.create(name, newDesc.trim());
      setNewName('');
      setNewDesc('');
      setShowCreate(false);
      toast('Project created');
      loadProjects();
    } catch (err) {
      toast('Failed to create project', 'error');
    }
  }

  async function deleteProject(projId) {
    const ok = await confirm('Delete this project? Recordings will be unlinked but not deleted.');
    if (!ok) return;
    try {
      await window.api.projects.remove(projId);
      toast('Project deleted');
      if (id === projId) navigate('/projects');
      loadProjects();
    } catch (err) {
      toast('Failed to delete project', 'error');
    }
  }

  async function copySummary() {
    if (!detail?.summary) return;
    await window.api.system.copyToClipboard(detail.summary);
    toast('Summary copied');
  }

  async function copySummaryPlain() {
    if (!detail?.summary) return;
    await window.api.system.copyToClipboard(stripMarkdown(detail.summary));
    toast('Summary copied');
  }

  async function saveSummary() {
    if (!detail?.summary) return;
    const safeName = detail.name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
    const result = await window.api.system.saveFile(`${safeName} — summary.md`, detail.summary);
    if (result.ok) toast('File saved');
  }

  async function generateSummary() {
    setGenerating(true);
    const result = await window.api.projects.generateSummary(detail.id);
    setGenerating(false);
    if (result.ok) {
      toast('Project summary generated');
      loadDetail(detail.id);
    } else {
      toast(result.error, 'error');
    }
  }

  if (loading) return null;

  // ---- Project detail view ----
  if (detail) {
    const transcribedCount = detail.recordings.filter(
      (r) => r.status === 'transcribed' || r.transcript_path
    ).length;

    return (
      <>
        <div className="topbar">
          <div className="page-title">{detail.name}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/projects')}>
              ← Projects
            </button>
            <button className="btn btn-danger btn-sm" onClick={() => deleteProject(detail.id)}>
              Delete project
            </button>
          </div>
        </div>
        <div className="content">
          {detail.description && (
            <p style={{ color: 'var(--ink-3)', marginBottom: 24, fontStyle: 'italic' }}>
              {detail.description}
            </p>
          )}

          {/* Project summary section */}
          <div className="project-summary-section">
            <div className="section-heading">
              <span>Project <em>summary</em></span>
            </div>

            {detail.summary ? (
              <div className="project-summary-content">
                <Markdown>{detail.summary}</Markdown>
              </div>
            ) : (
              <div className="project-summary-empty">
                {transcribedCount > 0
                  ? 'No summary generated yet. Generate one from your transcripts.'
                  : 'Transcribe recordings in this project to generate a summary.'}
              </div>
            )}

            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={generateSummary}
                disabled={generating || transcribedCount === 0}
              >
                {generating
                  ? 'Generating...'
                  : detail.summary
                    ? 'Regenerate summary'
                    : 'Generate summary'}
              </button>
              {detail.summary && (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={copySummary}>
                    Copy
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={copySummaryPlain}>
                    Copy plain
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={saveSummary}>
                    Save .md
                  </button>
                </>
              )}
              {transcribedCount > 0 && (
                <span style={{ fontSize: 11, color: 'var(--ink-3)', alignSelf: 'center' }}>
                  from {transcribedCount} transcribed recording{transcribedCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </div>

          {/* Recordings section */}
          <div style={{ marginTop: 40 }}>
            <div className="section-heading">
              <span>Recordings</span>
            </div>
            <div className="library-count" style={{ marginBottom: 12 }}>
              {detail.recordings.length} recording{detail.recordings.length === 1 ? '' : 's'}
            </div>

            {detail.recordings.length === 0 ? (
              <div className="empty" style={{ paddingTop: 40 }}>
                <div className="empty-mark">§</div>
                <h2>No recordings yet</h2>
                <p>Assign recordings to this project from the recording detail view.</p>
              </div>
            ) : (
              detail.recordings.map((r) => (
                <div
                  key={r.id}
                  className="recording-row"
                  onClick={() => navigate(`/recording/${r.id}`)}
                >
                  <div>
                    <div className="recording-title">{r.title}</div>
                    <div className="recording-meta">
                      <span className="recording-meta-item">{formatRelativeTime(r.created_at)}</span>
                    </div>
                  </div>
                  <div>
                    <span className={`status-pill status-${r.status}`}>
                      {statusLabel(r.status)}
                    </span>
                  </div>
                  <div className="artifact-count">
                    {r.artifact_count > 0 ? `${r.artifact_count} doc${r.artifact_count === 1 ? '' : 's'}` : '—'}
                  </div>
                  <div className="duration">{formatDuration(r.duration_seconds)}</div>
                  <div></div>
                </div>
              ))
            )}
          </div>
        </div>
      </>
    );
  }

  // ---- Projects list view ----
  return (
    <>
      <div className="topbar">
        <div className="page-title"><em>Projects</em></div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
          New project
        </button>
      </div>
      <div className="content">
        {showCreate && (
          <div className="field-group" style={{ maxWidth: 480, marginBottom: 24 }}>
            <div className="field">
              <label>Name</label>
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Acme CRM build"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && createProject()}
              />
            </div>
            <div className="field">
              <label>Description</label>
              <input
                className="input"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Optional — what this body of work covers"
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" onClick={createProject}>Create</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        )}

        {projects.length === 0 && !showCreate ? (
          <div className="empty">
            <div className="empty-mark">§</div>
            <h2>No projects yet</h2>
            <p>
              Projects group recordings into a larger body of work.
              Create one, then assign recordings from the library.
            </p>
          </div>
        ) : (
          projects.map((p) => (
            <div
              key={p.id}
              className="recording-row"
              onClick={() => navigate(`/projects/${p.id}`)}
            >
              <div>
                <div className="recording-title">{p.name}</div>
                <div className="recording-meta">
                  {p.description && (
                    <span className="recording-meta-item">{p.description}</span>
                  )}
                </div>
                {p.summary && (
                  <div className="project-snippet">
                    {p.summary.replace(/[#*_>\-\[\]()]/g, '').slice(0, 160).trim()}…
                  </div>
                )}
              </div>
              <div>
                {p.summary && (
                  <span style={{ fontSize: 11, color: 'var(--moss)' }}>summary</span>
                )}
              </div>
              <div className="artifact-count">
                {p.recording_count} recording{p.recording_count === 1 ? '' : 's'}
              </div>
              <div></div>
              <div></div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
