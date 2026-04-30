import React, { useState, useEffect, useRef } from 'react';
import { useToast } from '../lib/toast';
import { formatDuration } from '../lib/format';

export default function RecordingControl({ onChanged }) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef(null);
  const tickRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    const status = await window.api.recording.status();
    setIsRecording(status.isRecording);
    if (status.isRecording && status.startedAt) {
      startedAtRef.current = status.startedAt;
      startTick();
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
      <button className="record-button" onClick={handleClick}>
        {isRecording ? 'Stop' : 'Start Recording'}
      </button>
    </div>
  );
}
