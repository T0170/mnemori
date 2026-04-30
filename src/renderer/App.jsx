import React, { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Library from './pages/Library';
import RecordingDetail from './pages/RecordingDetail';
import Settings from './pages/Settings';
import Concepts from './pages/Concepts';
import Projects from './pages/Projects';
import { ToastProvider } from './lib/toast';

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <ToastProvider>
      <div className="app">
        <Sidebar onRecordingChanged={() => setRefreshKey((k) => k + 1)} />
        <main className="main">
          <Routes>
            <Route path="/" element={<Library refreshKey={refreshKey} />} />
            <Route path="/recording/:id" element={<RecordingDetail />} />
            <Route path="/concepts" element={<Concepts />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<Projects />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </ToastProvider>
  );
}
