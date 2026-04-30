import React from 'react';
import { NavLink } from 'react-router-dom';
import RecordingControl from './RecordingControl';

export default function Sidebar({ onRecordingChanged }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">Mnemor<span className="brand-i">i</span></div>
        <div className="brand-tagline">Spoken memory.</div>
      </div>

      <div className="nav-label">Workspace</div>
      <nav className="nav">
        <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          Library
        </NavLink>
        <NavLink to="/concepts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          Concepts
        </NavLink>
        <NavLink to="/projects" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          Projects
        </NavLink>
      </nav>

      <div className="nav-divider" />

      <div className="nav-label">Configure</div>
      <nav className="nav">
        <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          Settings
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <RecordingControl onChanged={onRecordingChanged} />
      </div>
    </aside>
  );
}
