import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import RecordingControl from './RecordingControl';

export default function Sidebar({ onRecordingChanged }) {
  const { isSignedIn, user, roleName, can, signIn, signOut, requireAuth } = useAuth();
  const [quickSearch, setQuickSearch] = useState('');
  const [updateReady, setUpdateReady] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!window.api?.updater) return;
    const unsub = window.api.updater.onUpdateDownloaded((version) => {
      setUpdateReady(version);
    });
    return unsub;
  }, []);

  function handleSearchSubmit(e) {
    e.preventDefault();
    if (quickSearch.trim()) {
      navigate('/?q=' + encodeURIComponent(quickSearch.trim()));
      setQuickSearch('');
    }
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">Mnemor<span className="brand-i">i</span></div>
        <div className="brand-tagline">Spoken memory.</div>
      </div>

      <form className="sidebar-search" onSubmit={handleSearchSubmit}>
        <input
          className="input sidebar-search-input"
          type="text"
          placeholder="Search…"
          value={quickSearch}
          onChange={(e) => setQuickSearch(e.target.value)}
        />
      </form>

      <div className="nav-label">Workspace</div>
      <nav className="nav">
        <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          Library
        </NavLink>
        <NavLink to="/projects" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          Projects
        </NavLink>
        <NavLink to="/concepts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          Concepts
        </NavLink>
      </nav>

      <div className="nav-divider" />

      <div className="nav-label">Configure</div>
      <nav className="nav">
        <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          Settings
        </NavLink>
        {can('admin:access') && (
          <NavLink to="/admin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            Admin
          </NavLink>
        )}
      </nav>

      <div className="sidebar-account">
        {isSignedIn && user ? (
          <div className="account-info">
            {user.imageUrl && (
              <img src={user.imageUrl} alt="" className="account-avatar" />
            )}
            <div className="account-details">
              <div className="account-name">{user.name || user.email}</div>
              <div className="account-role">
                {user.orgName || 'Personal'} · {roleName}
              </div>
            </div>
            <button className="account-signout" onClick={signOut} title="Sign out">
              &times;
            </button>
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm account-signin" onClick={signIn}>
            Sign in
          </button>
        )}
      </div>

      {updateReady && (
        <div className="update-banner">
          <span className="update-banner-text">v{updateReady} ready</span>
          <button className="btn btn-sm update-banner-btn" onClick={() => window.api.updater.install()}>
            Restart to update
          </button>
        </div>
      )}

      <div className="sidebar-footer">
        {requireAuth ? (
          <div style={{ padding: '12px 0', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 8 }}>Sign in to start recording</p>
            <button className="btn btn-primary btn-sm" onClick={signIn}>Sign in</button>
          </div>
        ) : (
          <RecordingControl onChanged={onRecordingChanged} />
        )}
      </div>
    </aside>
  );
}
