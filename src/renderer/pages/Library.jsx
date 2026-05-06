import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '../lib/toast';
import { formatDuration, formatRelativeTime, statusLabel } from '../lib/format';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'longest', label: 'Longest first' },
  { value: 'title', label: 'Title A–Z' },
];

export default function Library({ refreshKey }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [projects, setProjects] = useState([]);
  const [assigning, setAssigning] = useState(null);
  const [contentHits, setContentHits] = useState([]);
  const [decayCount, setDecayCount] = useState(0);
  const debounceRef = useRef(null);
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      setSearch(q);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);

  const closeDropdown = useCallback(() => setAssigning(null), []);
  useEffect(() => {
    if (assigning) {
      document.addEventListener('click', closeDropdown);
      return () => document.removeEventListener('click', closeDropdown);
    }
  }, [assigning, closeDropdown]);

  useEffect(() => {
    load();
    loadProjects();
    loadDecayCount();
    const unsub = window.api.recordings.onChanged(() => { load(); loadProjects(); loadDecayCount(); });
    return unsub;
  }, [refreshKey]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (search.trim().length >= 2) {
      debounceRef.current = setTimeout(async () => {
        const hits = await window.api.recordings.search(search.trim());
        setContentHits(hits);
      }, 300);
    } else {
      setContentHits([]);
    }
  }, [search]);

  async function load() {
    try {
      const list = await window.api.recordings.list();
      setRecordings(list);
    } catch (err) {
      toast('Failed to load recordings', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadProjects() {
    try {
      const list = await window.api.projects.list();
      setProjects(list);
    } catch (_) {}
  }

  async function loadDecayCount() {
    try {
      const alerts = await window.api.decay.list();
      setDecayCount(alerts.length);
    } catch (_) {}
  }

  async function assignProject(recordingId, projectName) {
    await window.api.recordings.update(recordingId, { project: projectName });
    toast(projectName ? `Assigned to ${projectName}` : 'Removed from project');
    setAssigning(null);
    load();
  }

  const filtered = useMemo(() => {
    let list = recordings;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          (r.project && r.project.toLowerCase().includes(q)) ||
          (r.tags && r.tags.toLowerCase().includes(q))
      );
    }

    const sorted = [...list];
    switch (sort) {
      case 'oldest':
        sorted.sort((a, b) => a.created_at - b.created_at);
        break;
      case 'longest':
        sorted.sort((a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0));
        break;
      case 'title':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      default:
        sorted.sort((a, b) => b.created_at - a.created_at);
    }

    return sorted;
  }, [recordings, search, sort]);

  // Group content hits by recording, excluding recordings already in filtered results
  const contentResults = useMemo(() => {
    if (!search.trim() || contentHits.length === 0) return [];
    const filteredIds = new Set(filtered.map((r) => r.id));
    const grouped = {};
    for (const hit of contentHits) {
      if (!grouped[hit.recording_id]) {
        grouped[hit.recording_id] = {
          recording: recordings.find((r) => r.id === hit.recording_id),
          matches: [],
          inFiltered: filteredIds.has(hit.recording_id),
        };
      }
      grouped[hit.recording_id].matches.push(hit);
    }
    return Object.values(grouped).filter((g) => g.recording);
  }, [contentHits, filtered, recordings, search]);

  if (loading) {
    return (
      <>
        <div className="topbar">
          <div className="page-title">Your <em>library</em></div>
        </div>
        <div className="content">
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ink-4)' }}>Loading...</div>
        </div>
      </>
    );
  }

  if (recordings.length === 0) {
    return (
      <>
        <div className="topbar">
          <div className="page-title">Your <em>library</em></div>
        </div>
        <div className="content">
          <div className="empty">
            <div className="empty-mark">ø</div>
            <h2>Nothing remembered yet</h2>
            <p>
              Press <strong>Start Recording</strong> in the sidebar and narrate
              what you're working on. Mnemori captures your voice alongside the
              screen, then turns it into documentation, coaching notes, or
              cleaned-up prose — whichever you need.
            </p>
          </div>
        </div>
      </>
    );
  }

  const totalMatches = filtered.length + contentResults.filter((g) => !g.inFiltered).length;

  return (
    <>
      <div className="topbar">
        <div className="page-title">Your <em>library</em></div>
      </div>
      <div className="content">
        <div className="library-header">
          <div className="library-controls">
            <input
              className="input library-search"
              type="text"
              placeholder="Search recordings, transcripts, artifacts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="select library-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="library-count">
            {search.trim()
              ? `${totalMatches} result${totalMatches === 1 ? '' : 's'}`
              : `${recordings.length} recording${recordings.length === 1 ? '' : 's'}`}
          </div>
        </div>

        {decayCount > 0 && (
          <div className="decay-banner">
            {decayCount} document{decayCount === 1 ? '' : 's'} may be outdated — review from the recording detail page
          </div>
        )}

        {filtered.length === 0 && contentResults.length === 0 ? (
          <div className="empty" style={{ paddingTop: 48 }}>
            <div className="empty-mark">ø</div>
            <h2>No matches</h2>
            <p>Nothing matched "{search}"</p>
          </div>
        ) : (
          <>
            {filtered.map((r) => {
              const hits = contentResults.find((g) => g.inFiltered && g.recording?.id === r.id);
              return (
                <div
                  key={r.id}
                  className="recording-row"
                  onClick={() => navigate(`/recording/${r.id}`)}
                >
                  <div>
                    <div className="recording-title">{r.title}</div>
                    <div className="recording-meta">
                      <span className="recording-meta-item">
                        {formatRelativeTime(r.created_at)}
                      </span>
                      {r.project && (
                        <>
                          <span>·</span>
                          <span className="tag">{r.project}</span>
                        </>
                      )}
                    </div>
                    {hits && hits.matches.length > 0 && (
                      <div className="search-snippets">
                        {hits.matches.slice(0, 2).map((m, i) => (
                          <div key={i} className="search-snippet">
                            <span className="search-snippet-type">{m.type}</span>
                            <span className="search-snippet-text">{m.snippet}</span>
                          </div>
                        ))}
                      </div>
                    )}
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
                  {r.reasoning_density != null && (
                    <div className="reasoning-indicator" title={`Reasoning density: ${Math.round(r.reasoning_density * 100)}%`}>
                      <span className={`reasoning-dot reasoning-${r.reasoning_density >= 0.6 ? 'rich' : r.reasoning_density >= 0.3 ? 'moderate' : 'thin'}`} />
                    </div>
                  )}
                  <div
                    className="row-assign"
                    onClick={(e) => { e.stopPropagation(); setAssigning(assigning === r.id ? null : r.id); }}
                  >
                    <span className="row-assign-icon" title="Assign to project" role="button" aria-label="Assign to project">§</span>
                    {assigning === r.id && (
                      <div className="assign-dropdown" onClick={(e) => e.stopPropagation()}>
                        <div
                          className={`assign-option ${!r.project ? 'assign-active' : ''}`}
                          onClick={() => assignProject(r.id, '')}
                        >
                          — none —
                        </div>
                        {projects.map((p) => (
                          <div
                            key={p.id}
                            className={`assign-option ${r.project === p.name ? 'assign-active' : ''}`}
                            onClick={() => assignProject(r.id, p.name)}
                          >
                            {p.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {contentResults.filter((g) => !g.inFiltered).length > 0 && (
              <>
                <div className="search-divider">
                  Content matches
                </div>
                {contentResults.filter((g) => !g.inFiltered).map((group) => (
                  <div
                    key={group.recording.id}
                    className="recording-row"
                    onClick={() => navigate(`/recording/${group.recording.id}`)}
                  >
                    <div>
                      <div className="recording-title">{group.recording.title}</div>
                      <div className="recording-meta">
                        <span className="recording-meta-item">
                          {formatRelativeTime(group.recording.created_at)}
                        </span>
                        {group.recording.project && (
                          <>
                            <span>·</span>
                            <span className="tag">{group.recording.project}</span>
                          </>
                        )}
                      </div>
                      <div className="search-snippets">
                        {group.matches.slice(0, 2).map((m, i) => (
                          <div key={i} className="search-snippet">
                            <span className="search-snippet-type">{m.type}</span>
                            <span className="search-snippet-text">{m.snippet}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className={`status-pill status-${group.recording.status}`}>
                        {statusLabel(group.recording.status)}
                      </span>
                    </div>
                    <div className="artifact-count">
                      {group.recording.artifact_count > 0 ? `${group.recording.artifact_count} doc${group.recording.artifact_count === 1 ? '' : 's'}` : '—'}
                    </div>
                    <div className="duration">{formatDuration(group.recording.duration_seconds)}</div>
                    <div></div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
