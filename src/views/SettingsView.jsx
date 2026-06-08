import { useEffect, useState } from 'react';
import { api } from '../api.js';

const AGENT_COLOR = {
  job: 'var(--job)', email: 'var(--email)', council: 'var(--council)',
  accountability: 'var(--acct)', brief: 'var(--news)', archivist: 'var(--project)', tag: 'var(--accent)',
};
const STATUS_COLOR = { ok: 'var(--success)', error: 'var(--danger)', running: 'var(--warn)', skipped: 'var(--text-dim)' };
const usd = (n) => `$${(n || 0).toFixed(n >= 1 ? 2 : 4)}`;

function ago(ts) {
  if (!ts) return 'never';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
function when(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function SettingsView() {
  const [obs, setObs] = useState(null);
  const [interests, setInterests] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.observability().then(setObs).catch((e) => setError(e.message));
    api.briefInterests().then((r) => setInterests(r.interests)).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  async function addInterest() {
    const label = draft.trim();
    if (!label || busy) return;
    setBusy(true);
    try { await api.addBriefInterest(label); setDraft(''); const r = await api.briefInterests(); setInterests(r.interests); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function toggle(id) {
    await api.toggleBriefInterest(id).catch((e) => setError(e.message));
    const r = await api.briefInterests(); setInterests(r.interests);
  }
  async function remove(id) {
    await api.deleteBriefInterest(id).catch((e) => setError(e.message));
    const r = await api.briefInterests(); setInterests(r.interests);
  }

  if (error) {
    return (
      <div className="view active">
        <div className="card">
          <div className="card-title">couldn't reach the backend</div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {error}. Is the Nexus server running on <code>localhost:3001</code>?
          </p>
        </div>
      </div>
    );
  }

  const cost = obs?.cost || { today: 0, total: 0, calls: 0, daily: [] };
  const agents = obs?.agents || [];
  const errors = obs?.errors || [];
  const maxDaily = Math.max(0.0001, ...(cost.daily || []).map((d) => d.cost));

  return (
    <div className="view active">
      {/* cost summary */}
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--news)' }}>{usd(cost.today)}</div><div className="stat-label">spend today</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--accent)' }}>{usd(cost.total)}</div><div className="stat-label">all-time spend</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--job)' }}>{cost.calls}</div><div className="stat-label">Claude calls</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--success)' }}>{agents.filter((a) => a.lastRun?.status === 'ok').length}/{agents.length}</div><div className="stat-label">agents healthy</div></div>
      </div>

      <div className="home-grid">
        {/* agents — last run, next run, cost */}
        <div className="card">
          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>agents · runs & cost</div>
            <button className="btn" style={{ fontSize: 11, padding: '5px 12px' }} onClick={load}>refresh</button>
          </div>
          {agents.map((a) => {
            const st = a.lastRun?.status;
            return (
              <div className="agent-row" key={a.key}>
                <div className="agent-icon" style={{ background: `${AGENT_COLOR[a.key]}22`, color: AGENT_COLOR[a.key] }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>{a.label[0]}</span>
                </div>
                <div className="agent-info">
                  <div className="agent-name">{a.label} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>· {usd(a.costTotal)}</span></div>
                  <div className="agent-sub">
                    {st ? <>last {st} {ago(a.lastRun.started_at)}{a.lastRun.summary ? ` · ${a.lastRun.summary}` : ''}</> : 'never run'}
                    {a.nextRun ? ` · next ${when(a.nextRun)}` : ' · on-demand'}
                  </div>
                </div>
                <div className="agent-dot" style={{ background: STATUS_COLOR[st] || 'var(--text-dim)' }} />
              </div>
            );
          })}
        </div>

        {/* daily cost trend + error log */}
        <div>
          <div className="card">
            <div className="card-title">daily cost · last {cost.daily?.length || 0} days</div>
            {(!cost.daily || cost.daily.length === 0) && (
              <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No spend recorded yet.</p>
            )}
            {(cost.daily || []).map((d) => (
              <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
                <span className="text-xs text-mono text-dim" style={{ width: 54 }}>{d.day.slice(5)}</span>
                <div className="prog-track" style={{ flex: 1 }}>
                  <div className="prog-fill" style={{ width: `${Math.round((d.cost / maxDaily) * 100)}%`, background: 'var(--news)' }} />
                </div>
                <span className="text-xs text-mono" style={{ width: 56, textAlign: 'right' }}>{usd(d.cost)}</span>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-title">recent errors</div>
            {errors.length === 0
              ? <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No failed runs. All agents healthy.</p>
              : errors.map((e, i) => (
                <div className="agent-row" key={i}>
                  <div className="agent-info">
                    <div className="agent-name" style={{ color: 'var(--danger)' }}>{e.agent} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>· {ago(e.started_at)}</span></div>
                    <div className="agent-sub">{e.error}</div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* brief interest steering */}
      <div className="card">
        <div className="card-title">morning brief · interest tags</div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)', marginTop: -4, marginBottom: 12 }}>
          Click a tag to toggle it on/off. Active tags steer the news search directly — you don't need to edit any files.
          The brief merges these with interests it learns from your journal.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {interests.length === 0 && (
            <span className="text-sm" style={{ color: 'var(--text-dim)' }}>No tags yet — add one (e.g. “world cup”, “global news”, “AI research”).</span>
          )}
          {interests.map((it) => (
            <span key={it.id} className="tag"
              style={{
                cursor: 'pointer', userSelect: 'none',
                background: it.active ? 'var(--news-dim)' : 'var(--bg-raised)',
                color: it.active ? 'var(--news)' : 'var(--text-dim)',
                border: it.active ? '1px solid var(--news)' : '1px solid transparent',
              }}>
              <span onClick={() => toggle(it.id)}># {it.label}</span>
              <span onClick={() => remove(it.id)} style={{ marginLeft: 6, opacity: 0.6 }} title="remove">×</span>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="journal-input" style={{ minHeight: 0, height: 36, flex: 1, maxWidth: 320 }}
            placeholder="add an interest tag…" value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addInterest()} />
          <button className="btn btn-primary" disabled={busy || !draft.trim()} onClick={addInterest}>add</button>
        </div>
      </div>
    </div>
  );
}
