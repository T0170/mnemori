import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useToast } from '../lib/toast';
import Markdown from '../components/Markdown';

function VoiceInput({ value, onChange, placeholder, multiline, autoFocus }) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const toast = useToast();

  const stop = useCallback(() => {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop();
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (chunksRef.current.length === 0) return;

        setTranscribing(true);
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const arrayBuf = await blob.arrayBuffer();
        const result = await window.api.pipeline.transcribeBlob(arrayBuf);
        setTranscribing(false);

        if (result.ok && result.text) {
          const prev = (value || '').trim();
          onChange(prev ? prev + ' ' + result.text : result.text);
        } else if (!result.ok) {
          toast(result.error, 'error');
        }
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (_) {
      toast('Could not access microphone', 'error');
    }
  }

  const InputTag = multiline ? 'textarea' : 'input';
  const inputProps = multiline ? { rows: 4 } : {};

  return (
    <div className="voice-input-wrap">
      <InputTag
        className="input concepts-question-input"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        {...inputProps}
      />
      <button
        type="button"
        className={`voice-input-btn ${recording ? 'recording' : ''} ${transcribing ? 'transcribing' : ''}`}
        onClick={recording ? stop : startRecording}
        disabled={transcribing}
        title={recording ? 'Stop recording' : transcribing ? 'Transcribing…' : 'Record answer'}
      >
        {transcribing ? '…' : recording ? '■' : '●'}
      </button>
    </div>
  );
}

const PROFILE_QUESTIONS = [
  { key: 'name', label: 'What should we call you?', placeholder: 'Your preferred name' },
  { key: 'role', label: 'What do you do?', placeholder: 'Role, company, industry — whatever feels right', multiline: true },
  { key: 'goals', label: 'What are you working toward?', placeholder: 'Skills you want to develop, where you want to be in 6-12 months', multiline: true },
  { key: 'challenges', label: 'What do you find hardest right now?', placeholder: 'Presenting to clients, structuring data models, explaining technical concepts…', multiline: true },
  { key: 'confidence', label: 'What does confidence look like for you?', placeholder: 'What "being good at this" means to you', multiline: true },
  { key: 'freeform', label: 'Anything else?', placeholder: 'Context, goals, quirks, anything you think would help a coach understand you', multiline: true },
];

function OnboardingSurvey({ profile, onSave }) {
  const [draft, setDraft] = useState({});
  const [step, setStep] = useState(0);

  useEffect(() => {
    setDraft({ ...profile });
  }, [profile]);

  function update(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleFinish() {
    for (const q of PROFILE_QUESTIONS) {
      if (draft[q.key] !== undefined) {
        await window.api.profile.set(q.key, draft[q.key]);
      }
    }
    onSave();
  }

  const q = PROFILE_QUESTIONS[step];
  const isLast = step === PROFILE_QUESTIONS.length - 1;
  const canAdvance = step === 0 ? !!draft[q.key]?.trim() : true;

  return (
    <div className="concepts-onboarding">
      <div className="concepts-onboarding-header">
        <div className="empty-mark">∴</div>
        <h2>Before we begin</h2>
        <p>
          A few questions so Mnemori can tailor coaching to you.
          Answer as much or as little as you like — you can always come back and edit.
        </p>
      </div>

      <div className="concepts-survey-progress">
        {PROFILE_QUESTIONS.map((_, i) => (
          <div
            key={i}
            className={`concepts-progress-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
            onClick={() => i <= step && setStep(i)}
          />
        ))}
      </div>

      <div className="concepts-question">
        <label className="concepts-question-label">{q.label}</label>
        <VoiceInput
          value={draft[q.key] || ''}
          onChange={(val) => update(q.key, val)}
          placeholder={q.placeholder}
          multiline={q.multiline}
          autoFocus
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {step > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {isLast ? (
          <button className="btn btn-primary btn-sm" onClick={handleFinish} disabled={!canAdvance}>
            Finish
          </button>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => setStep(step + 1)} disabled={!canAdvance}>
            Next
          </button>
        )}
        {!isLast && (
          <button className="btn btn-ghost btn-sm" onClick={() => setStep(step + 1)} style={{ fontSize: 12 }}>
            Skip
          </button>
        )}
      </div>
    </div>
  );
}

function ProfileEditor({ profile, onDone }) {
  const [draft, setDraft] = useState({ ...profile });
  const toast = useToast();

  function update(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    for (const q of PROFILE_QUESTIONS) {
      await window.api.profile.set(q.key, draft[q.key] || '');
    }
    toast('Profile updated');
    onDone();
  }

  return (
    <div className="concepts-profile-editor">
      {PROFILE_QUESTIONS.map((q) => (
        <div key={q.key} className="field" style={{ marginBottom: 16 }}>
          <label>{q.label}</label>
          <VoiceInput
            value={draft[q.key] || ''}
            onChange={(val) => update(q.key, val)}
            placeholder={q.placeholder}
            multiline={q.multiline}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={save}>Save changes</button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

const METRIC_OPTIONS = [
  { value: 'filler_count', label: 'Filler words', direction: 'decrease', unit: 'per session' },
  { value: 'hedging_count', label: 'Hedging language', direction: 'decrease', unit: 'per session' },
  { value: 'self_corrections', label: 'Self-corrections', direction: 'decrease', unit: 'per session' },
  { value: 'confidence_score', label: 'Confidence', direction: 'increase', unit: '%', format: (v) => Math.round(v * 100) },
  { value: 'reasoning_density', label: 'Reasoning density', direction: 'increase', unit: '%', format: (v) => Math.round(v * 100) },
];

const MILESTONE_ICONS = { Trending: '↗', Streak: '⚡', Mastered: '✦' };

function GoalCard({ goal, insights, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState(null);

  const metaInfo = METRIC_OPTIONS.find((m) => m.value === goal.metric);
  const values = insights.map((i) => i[goal.metric]);
  const current = values.length > 0 ? values[values.length - 1] : null;
  const format = metaInfo?.format || ((v) => v);

  async function toggleExpand() {
    if (!expanded && !history) {
      const h = await window.api.goals.history(goal.metric);
      setHistory(h);
    }
    setExpanded(!expanded);
  }

  const maxVal = history ? Math.max(...history.map((h) => h.value), 1) : 1;

  return (
    <div className={`goal-card ${goal.achieved_at ? 'goal-achieved' : ''}`}>
      <div className="goal-card-header" onClick={toggleExpand}>
        <div className="goal-card-info">
          <div className="goal-card-label">{goal.label}</div>
          <div className="goal-card-meta">
            {metaInfo?.label} · {goal.direction === 'decrease' ? 'reduce' : 'improve'}
            {current !== null && <> · now {format(current)} {metaInfo?.unit}</>}
          </div>
        </div>
        <div className="goal-card-actions">
          {goal.milestones?.map((m) => (
            <span key={m.id} className="goal-milestone" title={m.detail}>
              {MILESTONE_ICONS[m.label] || '●'} {m.label}
            </span>
          ))}
          <span className="goal-expand">{expanded ? '▾' : '▸'}</span>
        </div>
      </div>

      {expanded && (
        <div className="goal-card-body">
          {history && history.length > 1 ? (
            <>
              <div className="goal-chart">
                {history.map((h, i) => (
                  <div key={i} className="goal-chart-bar-wrap" title={`${h.title || 'Session'}: ${format(h.value)}`}>
                    <div
                      className="goal-chart-bar"
                      style={{ height: `${Math.max((h.value / maxVal) * 100, 4)}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="goal-chart-labels">
                <span>{format(history[0].value)}</span>
                <span>{history.length} sessions</span>
                <span>{format(history[history.length - 1].value)}</span>
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--ink-4)', fontSize: 13 }}>
              Need more sessions to show a trend.
            </p>
          )}
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11, marginTop: 8 }}
            onClick={(e) => { e.stopPropagation(); onDelete(goal.id); }}
          >
            Remove goal
          </button>
        </div>
      )}
    </div>
  );
}

function AddGoalForm({ onAdd, existingMetrics }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [metric, setMetric] = useState('');

  if (!open) {
    return (
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        + Add goal
      </button>
    );
  }

  const available = METRIC_OPTIONS.filter((m) => !existingMetrics.includes(m.value));
  const selected = METRIC_OPTIONS.find((m) => m.value === metric);

  function submit() {
    if (!label.trim() || !metric) return;
    onAdd(label.trim(), metric, selected.direction);
    setLabel('');
    setMetric('');
    setOpen(false);
  }

  return (
    <div className="goal-add-form">
      <input
        className="input"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Goal name, e.g. 'Fewer filler words'"
        style={{ marginBottom: 8 }}
      />
      <select
        className="select"
        value={metric}
        onChange={(e) => setMetric(e.target.value)}
        style={{ marginBottom: 8 }}
      >
        <option value="">Choose a metric to track</option>
        {available.map((m) => (
          <option key={m.value} value={m.value}>{m.label} ({m.direction})</option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={!label.trim() || !metric}>
          Add
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

export default function Concepts() {
  const toast = useToast();
  const [profile, setProfile] = useState({});
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState([]);
  const [readouts, setReadouts] = useState([]);
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [goals, setGoals] = useState([]);
  const [optedIn, setOptedIn] = useState(null);
  const [orgDisabled, setOrgDisabled] = useState(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    try {
      const [prof, done, ins, ro, gl, oi, pcd] = await Promise.all([
        window.api.profile.getAll(),
        window.api.profile.isComplete(),
        window.api.concepts.insights(),
        window.api.concepts.readouts(),
        window.api.goals.list(),
        window.api.profile.get('conceptsOptedIn'),
        window.api.settings.get('policyConceptsDisabled'),
      ]);
      setProfile(prof);
      setComplete(done);
      setInsights(ins);
      setReadouts(ro);
      setGoals(gl);
      setOptedIn(oi === 'true');
      setOrgDisabled(pcd === 'true');

      if (ins.length >= 3) {
        const result = await window.api.goals.checkMilestones();
        if (result.awarded?.length > 0) {
          for (const a of result.awarded) {
            toast(`${MILESTONE_ICONS[a.milestone] || '●'} ${a.milestone}: ${a.goalLabel}`);
          }
          setGoals(await window.api.goals.list());
        }
      }
    } catch (err) {
      toast('Failed to load concepts data', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function generateReadout() {
    setGenerating(true);
    const result = await window.api.concepts.generateReadout();
    setGenerating(false);
    if (result.ok) {
      toast('Coaching readout generated');
      loadAll();
    } else {
      toast(result.error, 'error');
    }
  }

  async function runBackfill() {
    setBackfilling(true);
    const result = await window.api.concepts.backfill();
    setBackfilling(false);
    if (result.ok) {
      toast(`Analyzed ${result.count} recording${result.count === 1 ? '' : 's'}`);
      loadAll();
    } else {
      toast(result.error, 'error');
    }
  }

  const aggregated = useMemo(() => {
    if (insights.length === 0) return null;

    let totalFillers = 0, totalCorrections = 0, totalHedging = 0, totalConfidence = 0, totalReasoning = 0;
    const allTopics = {};
    const allConcepts = {};
    const allStrengths = {};
    const allEdges = {};

    for (const ins of insights) {
      totalFillers += ins.filler_count;
      totalCorrections += ins.self_corrections;
      totalHedging += ins.hedging_count;
      totalConfidence += ins.confidence_score;
      totalReasoning += (ins.reasoning_density || 0);

      const safeParse = (val) => { try { return JSON.parse(val || '[]'); } catch (_) { return []; } };
      for (const t of safeParse(ins.topics)) {
        allTopics[t] = (allTopics[t] || 0) + 1;
      }
      for (const c of safeParse(ins.concepts)) {
        allConcepts[c] = (allConcepts[c] || 0) + 1;
      }
      for (const s of safeParse(ins.strengths)) {
        allStrengths[s] = (allStrengths[s] || 0) + 1;
      }
      for (const e of safeParse(ins.growth_edges)) {
        allEdges[e] = (allEdges[e] || 0) + 1;
      }
    }

    const sortByCount = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);

    return {
      sessions: insights.length,
      avgFillers: Math.round(totalFillers / insights.length),
      avgCorrections: Math.round(totalCorrections / insights.length * 10) / 10,
      avgHedging: Math.round(totalHedging / insights.length * 10) / 10,
      avgConfidence: Math.round(totalConfidence / insights.length * 100),
      avgReasoning: Math.round(totalReasoning / insights.length * 100),
      topics: sortByCount(allTopics).slice(0, 12),
      concepts: sortByCount(allConcepts).slice(0, 15),
      strengths: sortByCount(allStrengths).slice(0, 6),
      edges: sortByCount(allEdges).slice(0, 6),
    };
  }, [insights]);

  async function enableConcepts() {
    await window.api.profile.set('conceptsOptedIn', 'true');
    setOptedIn(true);
  }

  async function disableConcepts() {
    await window.api.profile.set('conceptsOptedIn', 'false');
    setOptedIn(false);
    toast('Concepts disabled');
  }

  if (loading) {
    return (
      <>
        <div className="topbar">
          <div className="page-title"><em>Concepts</em></div>
        </div>
        <div className="content">
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ink-4)' }}>Loading...</div>
        </div>
      </>
    );
  }

  if (orgDisabled) {
    return (
      <>
        <div className="topbar">
          <div className="page-title"><em>Concepts</em></div>
        </div>
        <div className="content">
          <div className="concepts-onboarding">
            <div className="concepts-onboarding-header">
              <div className="empty-mark">&sect;</div>
              <h2>Concepts is unavailable</h2>
              <p>Concepts has been disabled by your organization. Contact your admin for details.</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!optedIn) {
    return (
      <>
        <div className="topbar">
          <div className="page-title"><em>Concepts</em></div>
        </div>
        <div className="content">
          <div className="concepts-onboarding">
            <div className="concepts-onboarding-header">
              <div className="empty-mark">&sect;</div>
              <h2>Concepts</h2>
              <p>
                Concepts analyzes your speech patterns across recordings to surface
                communication strengths, growth edges, and trends over time.
              </p>
              <p style={{ marginTop: 12 }}>
                Each analysis sends your transcript to Claude, consuming API tokens.
                Analysis is optional and runs only when you choose.
              </p>
              <p style={{ marginTop: 12 }}>
                You can disable Concepts at any time from this page.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 24 }}>
              <button className="btn btn-primary btn-sm" onClick={enableConcepts}>
                Enable Concepts
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => window.history.back()}>
                Not now
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!complete && !editing) {
    return (
      <>
        <div className="topbar">
          <div className="page-title"><em>Concepts</em></div>
        </div>
        <div className="content">
          <OnboardingSurvey profile={profile} onSave={() => loadAll()} />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <div className="page-title"><em>Concepts</em></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(!editing)}>
            {editing ? 'Back to dashboard' : 'Edit profile'}
          </button>
        </div>
      </div>
      <div className="content">
        {editing ? (
          <ProfileEditor profile={profile} onDone={() => { setEditing(false); loadAll(); }} />
        ) : (
          <div className="concepts-dashboard">
            {/* Profile summary */}
            <div className="concepts-card">
              <h3>{profile.name || 'You'}</h3>
              {profile.role && <p style={{ color: 'var(--ink-2)', fontSize: 14 }}>{profile.role}</p>}
              {profile.goals && (
                <p style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 8 }}>
                  <strong>Working toward:</strong> {profile.goals}
                </p>
              )}
            </div>

            {/* Stats */}
            {aggregated ? (
              <>
                <div className="concepts-stats">
                  <div className="concepts-stat">
                    <div className="concepts-stat-value">{aggregated.sessions}</div>
                    <div className="concepts-stat-label">sessions analyzed</div>
                  </div>
                  <div className="concepts-stat">
                    <div className="concepts-stat-value">{aggregated.avgConfidence}%</div>
                    <div className="concepts-stat-label">avg confidence</div>
                  </div>
                  <div className="concepts-stat">
                    <div className="concepts-stat-value">{aggregated.avgFillers}</div>
                    <div className="concepts-stat-label">avg fillers / session</div>
                  </div>
                  <div className="concepts-stat">
                    <div className="concepts-stat-value">{aggregated.avgHedging}</div>
                    <div className="concepts-stat-label">avg hedging / session</div>
                  </div>
                  <div className="concepts-stat">
                    <div className="concepts-stat-value">{aggregated.avgReasoning}%</div>
                    <div className="concepts-stat-label">reasoning density</div>
                  </div>
                </div>

                {/* Goals */}
                <div className="concepts-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h3>Goals</h3>
                  </div>
                  {goals.map((g) => (
                    <GoalCard
                      key={g.id}
                      goal={g}
                      insights={insights}
                      onDelete={async (id) => {
                        await window.api.goals.delete(id);
                        setGoals(await window.api.goals.list());
                        toast('Goal removed');
                      }}
                    />
                  ))}
                  <AddGoalForm
                    existingMetrics={goals.map((g) => g.metric)}
                    onAdd={async (label, metric, direction) => {
                      await window.api.goals.create(label, metric, direction);
                      setGoals(await window.api.goals.list());
                      toast('Goal added');
                    }}
                  />
                </div>

                {/* Strengths & Growth */}
                <div className="concepts-two-col">
                  {aggregated.strengths.length > 0 && (
                    <div className="concepts-card">
                      <h3>Strengths</h3>
                      <ul className="concepts-list concepts-list-strengths">
                        {aggregated.strengths.map(([s, count]) => (
                          <li key={s}>{s} <span className="concepts-count">{count}x</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {aggregated.edges.length > 0 && (
                    <div className="concepts-card">
                      <h3>Growth edges</h3>
                      <ul className="concepts-list concepts-list-edges">
                        {aggregated.edges.map(([e, count]) => (
                          <li key={e}>{e} <span className="concepts-count">{count}x</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Topics & Concepts */}
                {aggregated.topics.length > 0 && (
                  <div className="concepts-card">
                    <h3>Topics</h3>
                    <div className="concepts-tags">
                      {aggregated.topics.map(([t, count]) => (
                        <span key={t} className="concepts-tag">{t} <span className="concepts-count">{count}</span></span>
                      ))}
                    </div>
                  </div>
                )}
                {aggregated.concepts.length > 0 && (
                  <div className="concepts-card">
                    <h3>Concepts &amp; terminology</h3>
                    <div className="concepts-tags">
                      {aggregated.concepts.map(([c, count]) => (
                        <span key={c} className="concepts-tag concepts-tag-term">{c} <span className="concepts-count">{count}</span></span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="concepts-card" style={{ textAlign: 'center', padding: 32 }}>
                <p style={{ color: 'var(--ink-3)', marginBottom: 16 }}>
                  No session data yet. Enable auto-extraction in Settings, or analyze your existing recordings.
                </p>
                <button className="btn btn-primary btn-sm" onClick={runBackfill} disabled={backfilling}>
                  {backfilling ? 'Analyzing recordings…' : 'Analyze recent recordings'}
                </button>
              </div>
            )}

            {/* Coaching readout */}
            <div className="concepts-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3>Coaching readout</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  {insights.length === 0 && (
                    <button className="btn btn-ghost btn-sm" onClick={runBackfill} disabled={backfilling}>
                      {backfilling ? 'Analyzing…' : 'Analyze recordings first'}
                    </button>
                  )}
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={generateReadout}
                    disabled={generating || insights.length === 0}
                  >
                    {generating ? 'Generating…' : readouts.length > 0 ? 'Regenerate' : 'Generate readout'}
                  </button>
                </div>
              </div>
              {readouts.length > 0 ? (
                <div className="artifact-content">
                  <Markdown>{readouts[0].content}</Markdown>
                  <div style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-4)' }}>
                    Based on {readouts[0].recording_count} sessions · Generated {new Date(readouts[0].created_at).toLocaleDateString()}
                  </div>
                </div>
              ) : (
                <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                  Generate a coaching readout to get personalized feedback based on your profile and session patterns.
                </p>
              )}
            </div>

            {/* Disable */}
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--rule)' }}>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, color: 'var(--ink-4)' }} onClick={disableConcepts}>
                Disable Concepts
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
