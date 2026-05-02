import React, { Component, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Library from './pages/Library';
import RecordingDetail from './pages/RecordingDetail';
import Settings from './pages/Settings';
import Admin from './pages/Admin';
import Concepts from './pages/Concepts';
import Projects from './pages/Projects';
import { ToastProvider } from './lib/toast';
import { AuthProvider } from './lib/auth';
import { ConfirmProvider } from './lib/confirm';

class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('React ErrorBoundary:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', marginBottom: 12 }}>Something went wrong</h2>
          <p>The page encountered an error. Your recordings are safe.</p>
          <button
            className="btn btn-ghost"
            style={{ marginTop: 16 }}
            onClick={() => { this.setState({ hasError: false }); window.location.hash = '/'; }}
          >
            Return to library
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
        <div className="app">
          <Sidebar onRecordingChanged={() => setRefreshKey((k) => k + 1)} />
          <main className="main">
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Library refreshKey={refreshKey} />} />
                <Route path="/recording/:id" element={<RecordingDetail />} />
                <Route path="/concepts" element={<Concepts />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/projects/:id" element={<Projects />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/admin" element={<Admin />} />
              </Routes>
            </ErrorBoundary>
          </main>
        </div>
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
