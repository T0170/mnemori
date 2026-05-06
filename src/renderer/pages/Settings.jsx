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
  const [decayDetection, setDecayDetection] = useState(false);
  const [customPrompts, setCustomPrompts] = useState([]);
  const [editingPrompt, setEditingPrompt] = useState(null);
  const [promptName, setPromptName] = useState('');
  const [promptText, setPromptText] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const [devices, dev, hk, at, agm, cae, ppd, dde, promptsResult] = await Promise.all([
        window.api.settings.listAudioDevices(),
        window.api.settings.get('audioDevice'),
        window.api.hotkey.get(),
        window.api.settings.get('autoTranscribe'),
        window.api.settings.get('autoGenerateMode'),
        window.api.settings.get('conceptsAutoExtract'),
        window.api.settings.get('policyAutoPipelineDisabled'),
        window.api.settings.get('decayDetectionEnabled'),
        window.api.prompts.list(),
      ]);
      setAudioDevices(devices);
      setSelectedDevice(dev || '');
      setHotkey(hk || '');
      setAutoTranscribe(at === 'true');
      setAutoGenerateMode(agm || '');
      setConceptsAutoExtract(cae === 'true');
      setPipelineDisabled(ppd === 'true');
      setDecayDetection(dde === 'true');
      if (promptsResult.ok) setCustomPrompts(promptsResult.prompts);
    } catch (err) {
      toast('Failed to load settings', 'error');
    } finally {
      setLoading(false);
    }
  }

  function startNewPrompt() {
    setEditingPrompt('new');
    setPromptName('');
    setPromptText('');
  }

  function startEditPrompt(p) {
    setEditingPrompt(p.id);
    setPromptName(p.name);
    setPromptText(p.prompt_text);
  }

  function cancelEdit() {
    setEditingPrompt(null);
    setPromptName('');
    setPromptText('');
  }

  async function savePrompt() {
    if (!promptName.trim() || !promptText.trim()) {
      toast('Name and prompt text are required', 'error');
      return;
    }
    try {
      if (editingPrompt === 'new') {
        const result = await window.api.prompts.create(promptName, promptText);
        if (!result.ok) { toast(result.error, 'error'); return; }
        toast('Prompt created');
      } else {
        const result = await window.api.prompts.update(editingPrompt, promptName, promptText);
        if (!result.ok) { toast(result.error, 'error'); return; }
        toast('Prompt updated');
      }
      cancelEdit();
      const r = await window.api.prompts.list();
      if (r.ok) setCustomPrompts(r.prompts);
    } catch (err) {
      toast('Failed to save prompt', 'error');
    }
  }

  async function deletePrompt(id) {
    try {
      await window.api.prompts.remove(id);
      const r = await window.api.prompts.list();
      if (r.ok) setCustomPrompts(r.prompts);
      toast('Prompt deleted');
    } catch (err) {
      toast('Failed to delete prompt', 'error');
    }
  }

  async function toggleDefault(id, currentlyDefault) {
    try {
      await window.api.prompts.setDefault(currentlyDefault ? null : id);
      const r = await window.api.prompts.list();
      if (r.ok) setCustomPrompts(r.prompts);
    } catch (err) {
      toast('Failed to update default', 'error');
    }
  }

  async function save() {
    try {
      await Promise.all([
        window.api.settings.set('audioDevice', selectedDevice),
        window.api.settings.set('autoTranscribe', autoTranscribe ? 'true' : ''),
        window.api.settings.set('autoGenerateMode', autoTranscribe ? autoGenerateMode : ''),
        window.api.settings.set('conceptsAutoExtract', conceptsAutoExtract ? 'true' : ''),
        window.api.settings.set('decayDetectionEnabled', decayDetection ? 'true' : ''),
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
                          <option value="checklist">Checklist</option>
                          <option value="executive_summary">Executive summary</option>
                          {customPrompts.map((p) => (
                            <option key={p.id} value={`custom:${p.id}`}>{p.name}</option>
                          ))}
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
                    <div className="field" style={{ marginTop: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={decayDetection}
                          onChange={(e) => setDecayDetection(e.target.checked)}
                        />
                        Detect outdated documentation
                      </label>
                      <p className="help" style={{ marginTop: 4, marginLeft: 26 }}>
                        After transcription, compares new recordings against existing project artifacts to find outdated documentation. Sends artifact content to Anthropic for comparison.
                      </p>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* ---- Custom Prompts ---- */}
          <div className="field-group">
            <h3>Custom prompts</h3>
            <p className="help">
              Create your own generation prompts. They appear alongside the built-in modes
              on each recording. Use <code>{'{transcript}'}</code> where you want the transcript inserted,
              or omit it and the full transcript will be sent as the user message.
            </p>

            {customPrompts.length > 0 && !editingPrompt && (
              <div className="prompt-list">
                {customPrompts.map((p) => (
                  <div key={p.id} className="prompt-item">
                    <div className="prompt-item-info">
                      <span className="prompt-item-name">{p.name}</span>
                      {p.is_default === 1 && <span className="prompt-item-default">default</span>}
                    </div>
                    <div className="prompt-item-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleDefault(p.id, p.is_default === 1)}>
                        {p.is_default === 1 ? 'Unset default' : 'Set as default'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => startEditPrompt(p)}>Edit</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--ember)' }} onClick={() => deletePrompt(p.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {editingPrompt ? (
              <div className="prompt-editor">
                <div className="field">
                  <label>Name</label>
                  <input
                    className="input"
                    value={promptName}
                    onChange={(e) => setPromptName(e.target.value)}
                    placeholder="e.g. Client Summary, Risk Assessment"
                  />
                </div>
                <div className="field" style={{ marginTop: 12 }}>
                  <label>Prompt</label>
                  <textarea
                    className="input prompt-textarea"
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    placeholder="You are an expert analyst reviewing a narrated screen recording..."
                    rows={10}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn btn-primary btn-sm" onClick={savePrompt}>
                    {editingPrompt === 'new' ? 'Create prompt' : 'Save changes'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={startNewPrompt} style={{ marginTop: 12 }}>
                + New prompt
              </button>
            )}
          </div>

          {/* ---- What Leaves Your Machine ---- */}
          <div className="field-group">
            <h3>What leaves your machine</h3>
            <p className="help">
              Mnemori keeps your recordings, transcripts, and artifacts on your local disk.
              The following data is sent to external services only when you trigger or enable the feature.
            </p>
            <table className="transparency-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Destination</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Audio (.wav)</td>
                  <td>OpenAI Whisper API</td>
                  <td>You click Transcribe or auto-transcribe is on</td>
                </tr>
                <tr>
                  <td>Transcript text</td>
                  <td>Anthropic Claude API</td>
                  <td>You click Generate or auto-generate is on</td>
                </tr>
                <tr>
                  <td>Screenshots (if captured)</td>
                  <td>Anthropic Claude API</td>
                  <td>Sent alongside transcript during generation</td>
                </tr>
                <tr>
                  <td>Transcript text</td>
                  <td>Anthropic Claude API</td>
                  <td>You click Extract on the Concepts page or auto-extract is on</td>
                </tr>
                <tr>
                  <td>Existing artifact content</td>
                  <td>Anthropic Claude API</td>
                  <td>Decay detection is enabled (opt-in) and a new recording is transcribed</td>
                </tr>
                <tr>
                  <td>Profile survey answers</td>
                  <td>Anthropic Claude API</td>
                  <td>You generate a coaching readout on the Concepts page</td>
                </tr>
              </tbody>
            </table>
            <p className="help" style={{ marginTop: 8 }}>
              Nothing is sent in the background unless you opt in. Video files never leave your machine.
            </p>
          </div>

          <div>
            <button className="btn btn-primary" onClick={save}>Save settings</button>
          </div>
        </div>
      </div>
    </>
  );
}
