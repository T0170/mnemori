import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useToast } from '../lib/toast';
import { useAuth } from '../lib/auth';

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
  const { isSignedIn, user, roleName, signIn, signOut } = useAuth();
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [loading, setLoading] = useState(true);
  const [hotkey, setHotkey] = useState('');
  const [hotkeyStatus, setHotkeyStatus] = useState(null);
  const [autoTranscribe, setAutoTranscribe] = useState(false);
  const [autoGenerateMode, setAutoGenerateMode] = useState('');
  const [conceptsAutoExtract, setConceptsAutoExtract] = useState(false);
  const [pipelineDisabled, setPipelineDisabled] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const [devices, dev, hk, at, agm, cae, ppd] = await Promise.all([
        window.api.settings.listAudioDevices(),
        window.api.settings.get('audioDevice'),
        window.api.hotkey.get(),
        window.api.settings.get('autoTranscribe'),
        window.api.settings.get('autoGenerateMode'),
        window.api.settings.get('conceptsAutoExtract'),
        window.api.settings.get('policyAutoPipelineDisabled'),
      ]);
      setAudioDevices(devices);
      setSelectedDevice(dev || '');
      setHotkey(hk || '');
      setAutoTranscribe(at === 'true');
      setAutoGenerateMode(agm || '');
      setConceptsAutoExtract(cae === 'true');
      setPipelineDisabled(ppd === 'true');
    } catch (err) {
      toast('Failed to load settings', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    try {
      await Promise.all([
        window.api.settings.set('audioDevice', selectedDevice),
        window.api.settings.set('autoTranscribe', autoTranscribe ? 'true' : ''),
        window.api.settings.set('autoGenerateMode', autoTranscribe ? autoGenerateMode : ''),
        window.api.settings.set('conceptsAutoExtract', conceptsAutoExtract ? 'true' : ''),
      ]);
      toast('Settings saved');
      load();
    } catch (err) {
      toast('Failed to save settings', 'error');
    }
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

          {/* ---- Account ---- */}
          <div className="field-group">
            <h3>Account</h3>
            {isSignedIn && user ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  {user.imageUrl && (
                    <img src={user.imageUrl} alt="" style={{ width: 36, height: 36, borderRadius: '50%' }} />
                  )}
                  <div>
                    <div style={{ fontWeight: 500 }}>{user.name || user.email}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{user.email}</div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 12 }}>
                  <strong>Role:</strong> {roleName}
                  {user.orgName && <> &middot; <strong>Organization:</strong> {user.orgName}</>}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>
              </div>
            ) : (
              <div>
                <p className="help" style={{ marginBottom: 12 }}>
                  Sign in to join an organization, or continue without an account.
                  Without an account you have full control — you manage your own API keys, retention, and data.
                </p>
                <button className="btn btn-ghost btn-sm" onClick={signIn}>Sign in</button>
              </div>
            )}
          </div>

          {/* ---- Audio ---- */}
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
              {loading ? 'Scanning...' : 'Re-scan devices'}
            </button>
            <AudioMeter />
          </div>

          {/* ---- Global hotkey ---- */}
          <div className="field-group">
            <h3>Global hotkey</h3>
            <p className="help">
              Press this shortcut from any application to start or stop recording.
              Uses Electron accelerator format (e.g. CommandOrControl+Shift+M).
            </p>
            <div className="field">
              <label>Shortcut</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="input"
                  value={hotkey}
                  onChange={(e) => { setHotkey(e.target.value); setHotkeyStatus(null); }}
                  placeholder="CommandOrControl+Shift+M"
                  style={{ width: 280 }}
                />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    const result = await window.api.hotkey.set(hotkey);
                    setHotkeyStatus(result.ok ? 'Registered' : result.error);
                    if (result.ok) toast('Hotkey updated');
                    else toast(result.error, 'error');
                  }}
                >
                  Apply
                </button>
                {hotkey && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      await window.api.hotkey.clear();
                      setHotkey('');
                      setHotkeyStatus(null);
                      toast('Hotkey disabled');
                    }}
                  >
                    Disable
                  </button>
                )}
              </div>
            </div>
            {hotkeyStatus && (
              <div style={{ fontSize: 12, marginTop: 4, color: hotkeyStatus === 'Registered' ? 'var(--moss)' : 'var(--ember)' }}>
                {hotkeyStatus}
              </div>
            )}
          </div>

          {/* ---- Auto-pipeline ---- */}
          <div className="field-group">
            <h3>Auto-pipeline</h3>
            {pipelineDisabled ? (
              <div className="policy-notice">
                Your organization has disabled automatic pipeline processing. Contact your admin to change this.
              </div>
            ) : (
              <>
                <p className="help">
                  By default, transcription and artifact generation are manual.
                  Enable these options to run them automatically after each recording.
                  Each run consumes API tokens.
                </p>
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={autoTranscribe}
                      onChange={(e) => {
                        setAutoTranscribe(e.target.checked);
                        if (!e.target.checked) setAutoGenerateMode('');
                      }}
                    />
                    Auto-transcribe after recording
                  </label>
                </div>
                {autoTranscribe && (
                  <>
                    <div className="field" style={{ marginTop: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={!!autoGenerateMode}
                          onChange={(e) => setAutoGenerateMode(e.target.checked ? 'sop' : '')}
                        />
                        Auto-generate artifact after transcription
                      </label>
                      {autoGenerateMode && (
                        <select
                          className="select"
                          value={autoGenerateMode}
                          onChange={(e) => setAutoGenerateMode(e.target.value)}
                          style={{ marginTop: 8, width: 220 }}
                        >
                          <option value="sop">SOP</option>
                          <option value="methodology">Methodology</option>
                          <option value="coaching">Coaching review</option>
                          <option value="notes">Cleaned notes</option>
                        </select>
                      )}
                    </div>
                    <div className="field" style={{ marginTop: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={conceptsAutoExtract}
                          onChange={(e) => setConceptsAutoExtract(e.target.checked)}
                        />
                        Auto-extract concepts for coaching
                      </label>
                      <p className="help" style={{ marginTop: 4, marginLeft: 26 }}>
                        Runs pattern analysis on each transcription for the Concepts dashboard.
                      </p>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <div>
            <button className="btn btn-primary" onClick={save}>Save settings</button>
          </div>
        </div>
      </div>
    </>
  );
}
