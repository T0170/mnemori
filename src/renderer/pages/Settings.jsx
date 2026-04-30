import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useToast } from '../lib/toast';

function AudioMeter() {
  const [level, setLevel] = useState(0);
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);
  const cleanupRef = useRef(null);

  const stop = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    setActive(false);
    setLevel(0);
  }, []);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      let raf;

      function tick() {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        setLevel(sum / data.length / 255);
        raf = requestAnimationFrame(tick);
      }
      tick();
      setActive(true);

      cleanupRef.current = () => {
        cancelAnimationFrame(raf);
        source.disconnect();
        ctx.close();
        stream.getTracks().forEach((t) => t.stop());
      };
    } catch (_) {
      setError('Could not access microphone');
    }
  }

  useEffect(() => () => stop(), [stop]);

  const barCount = 20;
  const litBars = Math.round(level * barCount);

  return (
    <div style={{ marginTop: 12 }}>
      <button className="btn btn-ghost btn-sm" onClick={active ? stop : start}>
        {active ? 'Stop test' : 'Test microphone'}
      </button>
      {active && (
        <div className="audio-meter" style={{ marginTop: 10 }}>
          <div className="audio-meter-bars">
            {Array.from({ length: barCount }, (_, i) => (
              <div
                key={i}
                className="audio-meter-bar"
                style={{
                  background: i < litBars
                    ? i < barCount * 0.6 ? 'var(--moss)' : i < barCount * 0.85 ? 'var(--ember-soft)' : 'var(--ember)'
                    : 'var(--paper-3)',
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
            Speak to test your input level
          </div>
        </div>
      )}
      {error && <div style={{ fontSize: 12, color: 'var(--ember)', marginTop: 6 }}>{error}</div>}
    </div>
  );
}

export default function Settings() {
  const toast = useToast();
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    const [devices, dev, ok, ak] = await Promise.all([
      window.api.settings.listAudioDevices(),
      window.api.settings.get('audioDevice'),
      window.api.settings.get('openaiApiKey'),
      window.api.settings.get('anthropicApiKey'),
    ]);
    setAudioDevices(devices);
    setSelectedDevice(dev || '');
    setOpenaiKey(ok || '');
    setAnthropicKey(ak || '');
    setLoading(false);
  }

  async function save() {
    await Promise.all([
      window.api.settings.set('audioDevice', selectedDevice),
      window.api.settings.set('openaiApiKey', openaiKey),
      window.api.settings.set('anthropicApiKey', anthropicKey),
    ]);
    toast('Settings saved');
  }

  async function rescanDevices() {
    setLoading(true);
    const devices = await window.api.settings.listAudioDevices();
    setAudioDevices(devices);
    setLoading(false);
    toast(`Found ${devices.length} audio device${devices.length === 1 ? '' : 's'}`);
  }

  return (
    <>
      <div className="topbar">
        <div className="page-title"><em>Settings</em></div>
      </div>
      <div className="content">
        <div className="settings-grid">

          <div className="field-group">
            <h3>Audio capture</h3>
            <p className="help">
              Pick the microphone you want to record. If your device isn't listed,
              make sure ffmpeg is installed and on your PATH, then re-scan.
            </p>
            <div className="field">
              <label>Microphone</label>
              <select
                className="select"
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
              >
                <option value="">— select a device —</option>
                {audioDevices.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={rescanDevices}
              disabled={loading}
            >
              {loading ? 'Scanning…' : 'Re-scan devices'}
            </button>
            <AudioMeter />
          </div>

          <div className="field-group">
            <h3>API keys</h3>
            <p className="help">
              Stored locally on your machine. Used only when you transcribe or generate.
            </p>
            <div className="field">
              <label>OpenAI (Whisper transcription)</label>
              <input
                className="input"
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-..."
              />
            </div>
            <div className="field">
              <label>Anthropic (Claude documentation)</label>
              <input
                className="input"
                type="password"
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                placeholder="sk-ant-..."
              />
            </div>
          </div>

          <div>
            <button className="btn btn-primary" onClick={save}>Save settings</button>
          </div>
        </div>
      </div>
    </>
  );
}
