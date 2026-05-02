import React, { useEffect, useState } from 'react';
import { useToast } from '../lib/toast';
import { useAuth } from '../lib/auth';
import { Navigate } from 'react-router-dom';

export default function Admin() {
  const toast = useToast();
  const { can } = useAuth();
  const [loading, setLoading] = useState(true);

  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiMask, setOpenaiMask] = useState('');
  const [anthropicMask, setAnthropicMask] = useState('');
  const [openaiDirty, setOpenaiDirty] = useState(false);
  const [anthropicDirty, setAnthropicDirty] = useState(false);

  const [retentionDays, setRetentionDays] = useState('');

  const [storagePath, setStoragePath] = useState('');
  const [storageIsDefault, setStorageIsDefault] = useState(true);

  const [policyAutoPipeline, setPolicyAutoPipeline] = useState(false);
  const [policyConcepts, setPolicyConcepts] = useState(false);

  const [auditEntries, setAuditEntries] = useState([]);
  const [showAudit, setShowAudit] = useState(false);

  const hasAccess = can('admin:access');
  useEffect(() => { if (hasAccess) load(); }, [hasAccess]);

  if (!hasAccess) return <Navigate to="/settings" replace />;

  async function load() {
    try {
      const [ok, ak, rd, sp, ppd, pcd] = await Promise.all([
        window.api.settings.get('openaiApiKey'),
        window.api.settings.get('anthropicApiKey'),
        window.api.settings.get('retentionDays'),
        window.api.storage.getPath(),
        window.api.settings.get('policyAutoPipelineDisabled'),
        window.api.settings.get('policyConceptsDisabled'),
      ]);
      setOpenaiMask(ok || '');
      setAnthropicMask(ak || '');
      setOpenaiKey('');
      setAnthropicKey('');
      setOpenaiDirty(false);
      setAnthropicDirty(false);
      setRetentionDays(rd || '');
      setStoragePath(sp.current);
      setStorageIsDefault(sp.isDefault);
      setPolicyAutoPipeline(ppd === 'true');
      setPolicyConcepts(pcd === 'true');
    } catch (err) {
      toast('Failed to load admin settings', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    try {
      const saves = [
        window.api.settings.set('retentionDays', retentionDays),
        window.api.settings.set('policyAutoPipelineDisabled', policyAutoPipeline ? 'true' : ''),
        window.api.settings.set('policyConceptsDisabled', policyConcepts ? 'true' : ''),
      ];
      if (openaiDirty && openaiKey) {
        saves.push(window.api.settings.set('openaiApiKey', openaiKey));
      }
      if (anthropicDirty && anthropicKey) {
        saves.push(window.api.settings.set('anthropicApiKey', anthropicKey));
      }
      await Promise.all(saves);
      toast('Administration settings saved');
      load();
    } catch (err) {
      toast('Failed to save admin settings', 'error');
    }
  }

  async function chooseStorage() {
    const result = await window.api.storage.choosePath();
    if (!result.ok) {
      if (result.error !== 'Cancelled') toast(result.error, 'error');
      return;
    }
    const setResult = await window.api.storage.setPath(result.path);
    if (setResult.ok) {
      toast('Storage path updated');
      setStoragePath(result.path);
      setStorageIsDefault(false);
    } else {
      toast(setResult.error, 'error');
    }
  }

  async function resetStorage() {
    const result = await window.api.storage.setPath('');
    if (result.ok) {
      toast('Storage path reset to default');
      load();
    }
  }

  async function loadAudit() {
    const entries = await window.api.audit.list(200);
    setAuditEntries(entries);
    setShowAudit(true);
  }

  if (loading) {
    return (
      <>
        <div className="topbar">
          <div className="page-title"><em>Administration</em></div>
        </div>
        <div className="content">
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ink-4)' }}>Loading...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <div className="page-title"><em>Administration</em></div>
      </div>
      <div className="content">
        <div className="settings-grid">

          {/* ---- API keys ---- */}
          <div className="field-group">
            <h3>API keys</h3>
            <p className="help">
              During early access, default keys are provided — you can start transcribing and generating
              right away. To use your own keys instead, enter them below. Keys are stored locally,
              encrypted at rest using your operating system's secure credential store.
            </p>
            <div className="field">
              <label>OpenAI (Whisper transcription)</label>
              {openaiMask && !openaiDirty && (
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
                  Current: {openaiMask}
                </div>
              )}
              <input
                className="input"
                type="password"
                value={openaiDirty ? openaiKey : ''}
                onChange={(e) => { setOpenaiKey(e.target.value); setOpenaiDirty(true); }}
                placeholder={openaiMask ? 'Enter new key to replace' : 'sk-...'}
              />
            </div>
            <div className="field">
              <label>Anthropic (Claude documentation)</label>
              {anthropicMask && !anthropicDirty && (
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
                  Current: {anthropicMask}
                </div>
              )}
              <input
                className="input"
                type="password"
                value={anthropicDirty ? anthropicKey : ''}
                onChange={(e) => { setAnthropicKey(e.target.value); setAnthropicDirty(true); }}
                placeholder={anthropicMask ? 'Enter new key to replace' : 'sk-ant-...'}
              />
            </div>
          </div>

          {/* ---- Retention ---- */}
          <div className="field-group">
            <h3>Data retention</h3>
            <p className="help">
              Automatically delete recordings older than the specified number of days.
              Leave blank to keep recordings indefinitely. Files are securely overwritten on deletion.
            </p>
            <div className="field">
              <label>Auto-delete after (days)</label>
              <input
                className="input"
                type="number"
                min="0"
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                placeholder="No limit"
                style={{ width: 180 }}
              />
            </div>
          </div>

          {/* ---- Storage ---- */}
          <div className="field-group">
            <h3>Storage</h3>
            <p className="help">
              Choose where Mnemori stores recordings, transcripts, and artifacts.
              Useful for pointing to a managed drive (OneDrive, Google Drive mount, NAS)
              or a compliance-approved directory.
            </p>
            <div className="field">
              <label>Storage directory</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className="storage-path-display">{storagePath}</div>
                <button className="btn btn-ghost btn-sm" onClick={chooseStorage}>Change</button>
                {!storageIsDefault && (
                  <button className="btn btn-ghost btn-sm" onClick={resetStorage}>Reset</button>
                )}
              </div>
              {storageIsDefault && (
                <p className="help" style={{ marginTop: 4 }}>Default location. New recordings are stored here.</p>
              )}
              {!storageIsDefault && (
                <p className="help" style={{ marginTop: 4 }}>
                  Custom location. New recordings will be stored here. Existing recordings remain accessible from their original paths.
                </p>
              )}
            </div>
          </div>

          {/* ---- Organization policies ---- */}
          <div className="field-group">
            <h3>Organization policies</h3>
            <p className="help">
              These policies control feature availability and token consumption
              across your organization. When enabled, all users are affected.
            </p>
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={policyAutoPipeline}
                  onChange={(e) => setPolicyAutoPipeline(e.target.checked)}
                />
                Disable auto-pipeline org-wide
              </label>
              <p className="help" style={{ marginTop: 4, marginLeft: 26 }}>
                Prevents automatic transcription and artifact generation after recordings.
                Users will still be able to run these manually.
              </p>
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={policyConcepts}
                  onChange={(e) => setPolicyConcepts(e.target.checked)}
                />
                Disable Concepts org-wide
              </label>
              <p className="help" style={{ marginTop: 4, marginLeft: 26 }}>
                Disables the Concepts coaching dashboard and all speech pattern analysis.
              </p>
            </div>
          </div>

          {/* ---- Security ---- */}
          <div className="field-group">
            <h3>Security and audit</h3>
            <p className="help">
              All security-relevant actions are recorded to a local audit trail.
              API keys are encrypted at rest using your operating system's secure credential store
              (Windows DPAPI / macOS Keychain).
            </p>
            <button className="btn btn-ghost btn-sm" onClick={loadAudit}>
              {showAudit ? 'Refresh audit log' : 'View audit log'}
            </button>
            {showAudit && (
              <div className="audit-log" style={{ marginTop: 12 }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rule)' }}>
                      <th style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)' }}>Time</th>
                      <th style={{ padding: '4px 8px' }}>Action</th>
                      <th style={{ padding: '4px 8px' }}>Target</th>
                      <th style={{ padding: '4px 8px' }}>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditEntries.map((e) => (
                      <tr key={e.id} style={{ borderBottom: '1px solid var(--paper-3)' }}>
                        <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', color: 'var(--ink-3)' }}>
                          {new Date(e.timestamp).toLocaleString()}
                        </td>
                        <td style={{ padding: '4px 8px' }}>{e.action}</td>
                        <td style={{ padding: '4px 8px', color: 'var(--ink-3)' }}>{e.target || '—'}</td>
                        <td style={{ padding: '4px 8px', color: 'var(--ink-3)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {e.detail || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {auditEntries.length === 0 && (
                  <div style={{ padding: 16, color: 'var(--ink-3)', textAlign: 'center' }}>
                    No audit entries yet
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <button className="btn btn-primary" onClick={save}>Save administration settings</button>
          </div>
        </div>
      </div>
    </>
  );
}
