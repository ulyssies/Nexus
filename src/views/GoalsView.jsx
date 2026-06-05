import { useEffect, useState } from 'react';
import { api } from '../api.js';

const CADENCES = ['daily', 'weekly'];

// momentum bar: current streak relative to the goal's own best (honest proxy —
// we don't invent a completion %; we show how live the streak is vs its record).
function momentum(streak) {
  const cur = streak?.current_count || 0;
  const best = streak?.longest_count || 0;
  if (!best) return cur ? 100 : 0;
  return Math.min(100, Math.round((cur / best) * 100));
}

function GoalRow({ goal }) {
  const cur = goal.streak?.current_count || 0;
  const best = goal.streak?.longest_count || 0;
  const pct = momentum(goal.streak);
  const color = cur > 0 ? 'var(--success)' : 'var(--text-dim)';
  return (
    <div className="goal-item">
      <div className="goal-header">
        <span className="goal-name">{goal.title}</span>
        <span className="goal-pct" style={{ color }}>{cur > 0 ? `🔥 ${cur}` : '—'}</span>
      </div>
      <div className="prog-track"><div className="prog-fill" style={{ width: `${pct}%`, background: color }} /></div>
      <div className="goal-meta">
        {goal.cadence} · current {cur} · best {best}
        {goal.target ? ` · target: ${goal.target}` : ''}
        {goal.target_date ? ` · by ${goal.target_date}` : ''}
      </div>
    </div>
  );
}

export default function GoalsView() {
  const [goals, setGoals] = useState([]);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', cadence: 'daily', target: '', category: '', target_date: '' });
  const [saving, setSaving] = useState(false);

  function load() {
    api.goals('active').then((r) => setGoals(r.goals)).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, []);

  async function handleAdd() {
    if (!form.title.trim() || saving) return;
    setSaving(true); setError(null);
    try {
      // strip empties so the repo gets clean nulls, not ""
      const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => String(v).trim()));
      await api.createGoal(payload);
      setForm({ title: '', cadence: 'daily', target: '', category: '', target_date: '' });
      setAdding(false);
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
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

  return (
    <div className="view active">
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--job)' }}>{goals.length}</div><div className="stat-label">active goals</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--success)' }}>{onStreak}</div><div className="stat-label">on a streak</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--acct)' }}>{best}</div><div className="stat-label">best streak</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--text-dim)' }}>{goals.length - onStreak}</div><div className="stat-label">need attention</div></div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>current goals</div>
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
        {goals.map((g) => <GoalRow key={g.id} goal={g} />)}
      </div>
    </div>
  );
}
