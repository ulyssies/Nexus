import { useEffect, useState } from 'react';
import { api } from '../api.js';

const fullDate = () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const clockTime = () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
const readMin = (text) => Math.max(1, Math.round((text || '').split(/\s+/).length / 200));

// relative time from a SQLite ('YYYY-MM-DD HH:MM:SS' UTC) or ISO timestamp
function ago(ts) {
  if (!ts) return '';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

// agent key → accent color var (matches the design's per-agent palette)
const AGENT_COLOR = { job: 'var(--job)', email: 'var(--email)', council: 'var(--council)', acct: 'var(--acct)', news: 'var(--news)', project: 'var(--project)' };

export default function HomeView({ onNavigate }) {
  const [time, setTime] = useState(clockTime());
  const [data, setData] = useState(null);        // /overview: stats, agents, feed
  const [brief, setBrief] = useState(null);
  const [goals, setGoals] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTime(clockTime()), 10000);
    return () => clearInterval(t);
  }, []);

  function load() {
    api.overview().then(setData).catch((e) => setError(e.message));
    api.brief().then((r) => setBrief(r.brief)).catch(() => {});
    api.goals('active').then((r) => setGoals(r.goals)).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  async function refreshBrief() {
    setBusy(true);
    try { const { brief } = await api.runBrief(); setBrief(brief); load(); }
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

  const s = data?.stats || {};
  const agents = data?.agents || [];
  const feed = data?.feed || [];
  const items = brief?.items || [];
  const go = (view) => onNavigate && onNavigate(view);

  return (
    <div className="view active">
      <div className="digest-header">
        <span className="digest-time">{time}</span>
        <span className="digest-date">{fullDate()}</span>
      </div>

      {/* top-line stats — all live */}
      <div className="stat-grid">
        <div className="stat-card" onClick={() => go('jobs')} style={{ cursor: 'pointer' }}>
          <div className="stat-value" style={{ color: 'var(--job)' }}>{s.strongMatches ?? '—'}</div>
          <div className="stat-label">strong job matches</div>
        </div>
        <div className="stat-card" onClick={() => go('calendar')} style={{ cursor: 'pointer' }}>
          <div className="stat-value" style={{ color: 'var(--email)' }}>{s.urgentEmails ?? '—'}</div>
          <div className="stat-label">urgent emails</div>
        </div>
        <div className="stat-card" onClick={() => go('accountability')} style={{ cursor: 'pointer' }}>
          <div className="stat-value" style={{ color: 'var(--acct)' }}>{s.bestStreak ?? '—'}</div>
          <div className="stat-label">day best streak</div>
        </div>
        <div className="stat-card" onClick={() => go('calendar')} style={{ cursor: 'pointer' }}>
          <div className="stat-value" style={{ color: 'var(--danger)' }}>{s.upcomingDeadlines ?? '—'}</div>
          <div className="stat-label">upcoming deadlines</div>
        </div>
      </div>

      <div className="home-grid">
        {/* AGENTS — live status, click through to each tab */}
        <div className="card">
          <div className="card-title">agents</div>
          {agents.map((a) => (
            <div className="agent-row" key={a.key} onClick={() => go(a.view)} style={{ cursor: 'pointer' }}>
              <div className="agent-icon" style={{ background: `var(--${a.key}-dim)`, color: AGENT_COLOR[a.key] }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>{a.name[0]}</span>
              </div>
              <div className="agent-info">
                <div className="agent-name">{a.name}</div>
                <div className="agent-sub">{a.sub}</div>
              </div>
              <div className={`agent-dot ${a.dot}`} />
            </div>
          ))}
        </div>

        {/* AGENT FEED — merged cross-agent activity */}
        <div className="card">
          <div className="card-title">agent feed</div>
          {feed.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No activity yet — the agents will fill this as they run.</p>
          )}
          {feed.map((f, i) => (
            <div className="feed-item" key={i}>
              <div className="feed-bar" style={{ background: AGENT_COLOR[f.agent] || 'var(--text-dim)' }} />
              <div className="feed-body">
                <div className="feed-text">{f.text}</div>
                <div className="feed-meta">{ago(f.at)} · {f.agent}</div>
              </div>
            </div>
          ))}
        </div>

        {/* MORNING BRIEF read */}
        <div className="card">
          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              morning brief{items.length ? ` · ${items.reduce((n, it) => n + readMin(it.summary), 0)} min read` : ''}
            </div>
            <button className="btn" style={{ fontSize: 11, padding: '5px 12px' }} disabled={busy} onClick={refreshBrief}>
              {busy ? 'curating…' : 'refresh'}
            </button>
          </div>
          {items.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
              No stories yet — hit refresh. (Needs a NEWS_API_KEY in server/.env.)
            </p>
          )}
          {items.slice(0, 4).map((it) => (
            <a className="article-item" key={it.id} href={it.source_url || '#'} target="_blank" rel="noreferrer"
              style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
              <div className="flex-1">
                {it.topic && <div className="article-source">{it.topic}</div>}
                <div className="article-title">{it.headline}</div>
                <div className="article-read">{readMin(it.summary)} min read</div>
              </div>
            </a>
          ))}
        </div>

        {/* GOALS SNAPSHOT */}
        <div className="card">
          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>goals snapshot</div>
            <button className="btn" style={{ fontSize: 11, padding: '5px 12px' }} onClick={() => go('goals')}>open goals</button>
          </div>
          {goals.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No active goals — add one in the Goals tab to start a streak.</p>
          )}
          {goals.slice(0, 5).map((g) => {
            const cur = g.streak?.current_count || 0;
            const best = g.streak?.longest_count || 0;
            const pct = best ? Math.min(100, Math.round((cur / best) * 100)) : (cur ? 100 : 0);
            const color = cur > 0 ? 'var(--success)' : 'var(--text-dim)';
            return (
              <div className="goal-item" key={g.id} style={{ borderBottom: 'none', paddingBottom: 8 }}>
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
    </div>
  );
}
