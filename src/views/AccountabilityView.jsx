import { useEffect, useState } from 'react';
import { api } from '../api.js';

// UTC date to match the server's today() (goalsRepo uses UTC ISO dates).
const utcToday = () => new Date().toISOString().slice(0, 10);

const STREAK_COLORS = ['var(--success)', 'var(--email)', 'var(--acct)', 'var(--job)'];

export default function AccountabilityView() {
  const [goals, setGoals] = useState([]);
  const [nudge, setNudge] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.goals('active').then((r) => setGoals(r.goals)).catch((e) => setError(e.message));
    api.accountabilityNudge().then(setNudge).catch(() => {/* nudge is best-effort */});
  }
  useEffect(() => { load(); }, []);

  async function checkin(goalId, status) {
    setBusy(true);
    try {
      await api.checkinGoal(goalId, { status });
      load(); // streak recomputed server-side; re-fetch to show it
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function runNow() {
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

  const today = utcToday();
  const loggedToday = (g) => g.streak?.last_checkin_date === today;
  const topStreaks = [...goals].sort((a, b) => (b.streak?.current_count || 0) - (a.streak?.current_count || 0)).slice(0, 4);

  return (
    <div className="view active">
      <div className="streak-row">
        {topStreaks.length === 0 && (
          <div className="streak-card"><div className="streak-num" style={{ color: 'var(--text-dim)' }}>0</div><div className="streak-label">no goals yet</div><div className="streak-status" style={{ color: 'var(--text-dim)' }}>add one in Goals</div></div>
        )}
        {topStreaks.map((g, i) => {
          const cur = g.streak?.current_count || 0;
          return (
            <div className="streak-card" key={g.id}>
              <div className="streak-num" style={{ color: STREAK_COLORS[i % STREAK_COLORS.length] }}>{cur}</div>
              <div className="streak-label">{g.title}</div>
              <div className="streak-status" style={{ color: cur > 0 ? 'var(--success)' : 'var(--text-dim)' }}>
                {cur > 0 ? 'active' : 'broken'}
              </div>
            </div>
          );
        })}
      </div>

      <div className="acct-layout">
        <div className="card">
          <div className="card-title">today's check-in</div>
          {goals.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No active goals — add some in the Goals view.</p>
          )}
          {goals.map((g) => {
            const done = loggedToday(g);
            return (
              <div className="checkin-item" key={g.id}>
                <div className={`check-box${done ? ' done' : ''}`} />
                <div className={`checkin-label${done ? ' done' : ''}`}>{g.title}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['done', 'partial', 'missed'].map((s) => (
                    <button key={s} className="btn" disabled={busy}
                      style={{ fontSize: 10, padding: '3px 8px' }}
                      onClick={() => checkin(g.id, s)}>{s}</button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="card">
          <div className="card-title">goal progress</div>
          {goals.map((g) => {
            const cur = g.streak?.current_count || 0;
            const best = g.streak?.longest_count || 0;
            const pct = best ? Math.min(100, Math.round((cur / best) * 100)) : (cur ? 100 : 0);
            const color = cur > 0 ? 'var(--success)' : 'var(--text-dim)';
            return (
              <div className="goal-item" key={g.id} style={{ borderBottom: 'none' }}>
                <div className="goal-header">
                  <span className="goal-name" style={{ fontSize: 12 }}>{g.title}</span>
                  <span className="goal-pct" style={{ color, fontSize: 12 }}>{cur > 0 ? `🔥 ${cur}` : '—'}</span>
                </div>
                <div className="prog-track"><div className="prog-fill" style={{ width: `${pct}%`, background: color }} /></div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>agent check-in · 8:00 PM daily</div>
          <button className="btn" style={{ fontSize: 11, padding: '5px 12px' }} disabled={busy} onClick={runNow}>
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
  );
}
