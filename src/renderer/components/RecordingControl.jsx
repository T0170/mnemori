import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '../lib/toast';
import { formatDuration } from '../lib/format';

export default function RecordingControl({ onChanged }) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [hasDevice, setHasDevice] = useState(true);
  const [snapFlash, setSnapFlash] = useState(false);
  const startedAtRef = useRef(null);
  const tickRef = useRef(null);
  const toast = useToast();

  const handleSnap = useCallback(async () => {
    const result = await window.api.recording.screenshot();
    if (result.ok) {
      setSnapFlash(true);
      setTimeout(() => setSnapFlash(false), 300);
    } else {
      toast(result.error, 'error');
    }
  }, [toast]);

  useEffect(() => {
    refresh();
    checkDevice();
    const unsub = window.api.recordings.onChanged(() => { refresh(); checkDevice(); });
    return unsub;
  }, []);

  async function checkDevice() {
    const device = await window.api.settings.get('audioDevice');
    setHasDevice(!!device);
  }

  async function refresh() {
    const status = await window.api.recording.status();
    setIsRecording(status.isRecording);
    if (status.isRecording && status.startedAt) {
      startedAtRef.current = status.startedAt;
      startTick();
    } else {
      stopTick();
      setElapsed(0);
      startedAtRef.current = null;
    }
  }

  function startTick() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      if (startedAtRef.current) {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
  }

  function stopTick() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }

  async function handleClick() {
    if (isRecording) {
      const result = await window.api.recording.stop();
      if (result.ok) {
        setIsRecording(false);
        stopTick();
        setElapsed(0);
        startedAtRef.current = null;
        toast('Recording saved');
        onChanged?.();
      } else {
        toast(result.error, 'error');
      }
    } else {
      const result = await window.api.recording.start({});
      if (result.ok) {
        setIsRecording(true);
        startedAtRef.current = Date.now();
        startTick();
        toast('Recording started');
        onChanged?.();
      } else {
        toast(result.error, 'error');
      }
    }
  }

  return (
    <div className={`record-card ${isRecording ? 'is-recording' : ''}`}>
      <div className="record-status">
        <span className="dot" />
        {isRecording ? 'Recording' : 'Idle'}
      </div>
      <div className="record-time">{formatDuration(elapsed)}</div>
      <div className="record-actions">
        <button className="record-button" onClick={handleClick} disabled={!isRecording && !hasDevice}>
          {isRecording ? 'Stop' : 'Start Recording'}
        </button>
        {isRecording && (
          <button
            className={`record-snap${snapFlash ? ' snap-flash' : ''}`}
            onClick={handleSnap}
            title="Capture screenshot (Ctrl+Shift+S)"
          >
            Snap
          </button>
        )}
      </div>
      {!hasDevice && !isRecording && (
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6, textAlign: 'center' }}>
          Select a microphone in Settings
        </div>
      )}
    </div>
  );
}
