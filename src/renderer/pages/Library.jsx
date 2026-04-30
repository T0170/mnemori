import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDuration, formatRelativeTime, statusLabel } from '../lib/format';

export default function Library({ refreshKey }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    load();
    const unsub = window.api.recordings.onChanged(load);
    return unsub;
  }, [refreshKey]);

  async function load() {
    const list = await window.api.recordings.list();
    setRecordings(list);
    setLoading(false);
  }

  if (loading) return null;

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

  return (
    <>
      <div className="topbar">
        <div className="page-title">Your <em>library</em></div>
      </div>
      <div className="content">
        <div className="library-header">
          <div></div>
          <div className="library-count">
            {recordings.length} recording{recordings.length === 1 ? '' : 's'}
          </div>
        </div>

        {recordings.map((r) => (
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
        ))}
      </div>
    </>
  );
}
