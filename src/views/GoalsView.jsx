import { useEffect, useState } from 'react';
import { api } from '../api.js';

const CADENCES = ['daily', 'weekly'];
// UTC date to match the server's today() (goalsRepo uses UTC ISO dates).
const utcToday = () => new Date().toISOString().slice(0, 10);

// One goal: streak + progress + today's check-in + delete — the merged
// Goals/Accountability row (add, track, check in, and remove in one place).
function GoalRow({ goal, busy, onCheckin, onDelete }) {
  const cur = goal.streak?.current_count || 0;
  const best = goal.streak?.longest_count || 0;
  const pct = best ? Math.min(100, Math.round((cur / best) * 100)) : (cur ? 100 : 0);
  const color = cur > 0 ? 'var(--success)' : 'var(--text-dim)';
  const doneToday = goal.streak?.last_checkin_date === utcToday();

  return (
    <div className="goal-item">
      <div className="goal-header">
        <span className="goal-name">{goal.title}</span>
        <div className="goal-row-right">
          <span className="goal-pct" style={{ color }}>{cur > 0 ? `🔥 ${cur}` : '—'}</span>
          <button className="goal-del" title="delete goal" onClick={() => onDelete(goal)}>✕</button>
        </div>
      </div>
      <div className="prog-track"><div className="prog-fill" style={{ width: `${pct}%`, background: color }} /></div>
      <div className="goal-meta">
        {goal.cadence} · current {cur} · best {best}
        {goal.category ? ` · ${goal.category}` : ''}
        {goal.target ? ` · target: ${goal.target}` : ''}
      </div>
      <div className="goal-checkin-row">
        {doneToday && <span className="goal-done-tag">✓ checked in today</span>}
        {['done', 'partial', 'missed'].map((s) => (
          <button key={s} className="btn" disabled={busy} style={{ fontSize: 10, padding: '3px 9px' }}
            onClick={() => onCheckin(goal.id, s)}>{s}</button>
        ))}
      </div>
    </div>
  );
}

export default function GoalsView() {
  const [goals, setGoals] = useState([]);
  const [nudge, setNudge] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', cadence: 'daily', target: '', category: '', target_date: '' });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  function load() {
    api.goals('active').then((r) => setGoals(r.goals)).catch((e) => setError(e.message));
    api.accountabilityNudge().then(setNudge).catch(() => {/* nudge is best-effort */});
  }
  useEffect(() => { load(); }, []);

  async function handleAdd() {
    if (!form.title.trim() || saving) return;
    setSaving(true); setError(null);
    try {
      const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => String(v).trim()));
      await api.createGoal(payload);
      setForm({ title: '', cadence: 'daily', target: '', category: '', target_date: '' });
      setAdding(false);
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function checkin(goalId, status) {
    setBusy(true);
    try { await api.checkinGoal(goalId, { status }); load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove(goal) {
    if (!window.confirm(`Delete “${goal.title}”? This removes its check-ins and streak history.`)) return;
    setBusy(true);
    try { await api.deleteGoal(goal.id); load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function runNudge() {
    setBusy(true);
    try { setNudge(await api.runAccountability()); load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
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

  const onStreak = goals.filter((g) => (g.streak?.current_count || 0) > 0).length;
  const best = goals.reduce((m, g) => Math.max(m, g.streak?.longest_count || 0), 0);
  const dueToday = goals.filter((g) => g.streak?.last_checkin_date !== utcToday()).length;

  return (
    <div className="view active">
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--job)' }}>{goals.length}</div><div className="stat-label">active goals</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--success)' }}>{onStreak}</div><div className="stat-label">on a streak</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--acct)' }}>{best}</div><div className="stat-label">best streak</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--danger)' }}>{dueToday}</div><div className="stat-label">due today</div></div>
      </div>

      <div className="goals-layout">
        {/* goals: add, track, check in, delete */}
        <div className="card">
          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>your goals</div>
            <button className="btn" style={{ fontSize: 11, padding: '5px 12px' }} onClick={() => setAdding((v) => !v)}>
              {adding ? 'cancel' : '+ add goal'}
            </button>
          </div>

          {adding && (
            <div className="goal-item" style={{ display: 'grid', gap: 8 }}>
              <input className="journal-input" style={{ minHeight: 0, height: 36 }}
                placeholder="Goal title (e.g. Gym — 5x per week)"
                value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select className="btn" value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })}>
                  {CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input className="journal-input" style={{ minHeight: 0, height: 36, flex: 1 }}
                  placeholder="target (e.g. 5x/week)" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
                <input className="journal-input" style={{ minHeight: 0, height: 36, flex: 1 }}
                  placeholder="category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                <input className="journal-input" style={{ minHeight: 0, height: 36 }} type="date"
                  value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} />
                <button className="btn btn-primary" disabled={saving || !form.title.trim()} onClick={handleAdd}>
                  {saving ? 'saving…' : 'create'}
                </button>
              </div>
            </div>
          )}

          {goals.length === 0 && !adding && (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No goals yet — add your first one.</p>
          )}
          {goals.map((g) => (
            <GoalRow key={g.id} goal={g} busy={busy} onCheckin={checkin} onDelete={remove} />
          ))}
        </div>

        {/* the accountability agent's nudge — merged in from its own tab */}
        <div className="card" style={{ alignSelf: 'start' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>agent check-in · 8:00 PM daily</div>
            <button className="btn" style={{ fontSize: 11, padding: '5px 12px' }} disabled={busy} onClick={runNudge}>
              {busy ? 'running…' : 'run now'}
            </button>
          </div>
          <div className="agent-msg">
            <div className="agent-msg-from">
              accountability agent{nudge?.source === 'template' ? ' · (no API key — templated)' : ''}
            </div>
            <div className="agent-msg-text">{nudge?.message || 'Loading your check-in…'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
