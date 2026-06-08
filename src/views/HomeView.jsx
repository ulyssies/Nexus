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

// short forward-looking label (for next scheduled runs)
function nextLabel(ts) {
  if (!ts) return 'on demand';
  const d = new Date(ts);
  const mins = Math.round((d.getTime() - Date.now()) / 60000);
  if (mins <= 0) return 'due now';
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.round(hrs / 24)}d`;
}

const eventTime = (ts, allDay) => {
  if (allDay) return 'all day';
  if (!ts) return '';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

// calendar source -> chip color + human label (matches the per-agent palette)
const SRC_COLOR = { email: 'var(--email)', user: 'var(--accent)', job: 'var(--job)', accountability: 'var(--acct)' };
const SRC_LABEL = { email: 'email agent', user: 'manual', job: 'job agent', accountability: 'accountability' };

// parse a SQLite ('YYYY-MM-DD HH:MM:SS' UTC) or ISO timestamp to a local Date
function parseTs(ts) {
  if (!ts) return null;
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}
// local YYYY-MM-DD key for grouping events by calendar day
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// render the digest's **bold labels** without pulling in a markdown dependency
function renderRich(text) {
  if (!text) return null;
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p)
      ? <strong key={i} style={{ color: 'var(--text-primary)' }}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>);
}

// agent key → accent color var (matches the design's per-agent palette)
const AGENT_COLOR = { job: 'var(--job)', email: 'var(--email)', council: 'var(--council)', acct: 'var(--acct)', news: 'var(--news)', project: 'var(--project)' };

// feed filter bar: label → the feed agent key it matches ('all' = everything)
const FEED_FILTERS = [
  { label: 'all', key: 'all' },
  { label: 'jobs', key: 'job' },
  { label: 'email', key: 'email' },
  { label: 'accountability', key: 'acct' },
  { label: 'brief', key: 'news' },
  { label: 'archivist', key: 'project' },
];

const STATUS_STYLE = {
  done: { label: 'done', color: 'var(--success)' },
  due: { label: 'due', color: 'var(--warn)' },
  missed: { label: 'missed', color: 'var(--danger)' },
};

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const navBtn = { background: 'none', border: '1px solid var(--border-dim)', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '1px 9px' };

// Compact month-grid widget for the Today column: marks today, shows source-
// colored event chips per day, click a day for a popover of that day's events,
// prev/next month nav. Reads the same calendar_events the Calendar view uses.
function MiniCalendar({ events }) {
  const now = new Date();
  const [view, setView] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [selected, setSelected] = useState(null);   // dayKey string or null

  const byDay = {};
  for (const e of events) {
    const d = parseTs(e.start_at);
    if (!d) continue;
    (byDay[dayKey(d)] ||= []).push(e);
  }

  const year = view.getFullYear();
  const month = view.getMonth();
  const startPad = new Date(year, month, 1).getDay();          // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = dayKey(now);

  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const shift = (delta) => { setSelected(null); setView(new Date(year, month + delta, 1)); };
  const selEvents = selected ? (byDay[selected] || []) : [];

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <button onClick={() => shift(-1)} style={navBtn} aria-label="previous month">‹</button>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
          {view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <button onClick={() => shift(1)} style={navBtn} aria-label="next month">›</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
        {WEEKDAYS.map((w, i) => (
          <div key={`h${i}`} style={{ textAlign: 'center', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', padding: '2px 0' }}>{w}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} />;
          const k = dayKey(d);
          const evs = byDay[k] || [];
          const isToday = k === todayKey;
          const isSel = k === selected;
          return (
            <button key={k}
              onClick={() => setSelected(isSel ? null : (evs.length ? k : null))}
              style={{
                aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 2, padding: 0, cursor: evs.length ? 'pointer' : 'default',
                borderRadius: 6, border: isSel ? '1px solid var(--border-mid)' : '1px solid transparent',
                background: isToday ? 'var(--accent-dim)' : (isSel ? 'var(--bg-hover)' : 'transparent'),
                color: isToday ? 'var(--accent)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: isToday ? 700 : 400,
              }}>
              <span>{d.getDate()}</span>
              <span style={{ display: 'flex', gap: 2, height: 4 }}>
                {evs.slice(0, 3).map((e, j) => (
                  <span key={j} style={{ width: 4, height: 4, borderRadius: '50%', background: SRC_COLOR[e.source_agent] || 'var(--text-dim)' }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg-raised)', border: '1px solid var(--border-soft)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginBottom: 6 }}>
            {new Date(`${selected}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
          {selEvents.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: SRC_COLOR[e.source_agent] || 'var(--text-dim)', flexShrink: 0 }} />
              <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', minWidth: 52, flexShrink: 0 }}>{eventTime(e.start_at, e.all_day)}</span>
              <span style={{ fontSize: 12, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>{e.title}</span>
              <span className="src-badge">{SRC_LABEL[e.source_agent] || e.source_agent}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        {['email', 'user', 'job'].map((s) => (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: SRC_COLOR[s] }} />{SRC_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function HomeView({ onNavigate }) {
  const [time, setTime] = useState(clockTime());
  const [data, setData] = useState(null);     // /api/home payload
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [showArchivist, setShowArchivist] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [digestBusy, setDigestBusy] = useState(false);
  const [checking, setChecking] = useState({});  // goalId -> bool
  const [events, setEvents] = useState([]);       // all calendar events (month grid)

  useEffect(() => {
    const t = setInterval(() => setTime(clockTime()), 10000);
    return () => clearInterval(t);
  }, []);

  function load() {
    // the month-grid widget reads the same calendar_events as the Calendar view
    api.calendar(true).then((r) => setEvents(r.events || [])).catch(() => {});
    return api.home().then((d) => {
      setData(d);
      // lazily fill the digest: only fires Claude when there's no digest yet or
      // the cached one is stale (>6h) — the endpoint enforces the TTL.
      if (d.brief?.hasBriefToday && (!d.brief.digest || d.brief.stale)) ensureDigest(false);
      return d;
    }).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, []);

  async function ensureDigest(force) {
    setDigestBusy(true);
    try {
      const r = await api.briefDigest(force);
      setData((prev) => prev ? { ...prev, brief: { ...prev.brief, digest: r.digest, digestAt: r.digestAt, stale: false } } : prev);
    } catch { /* keep the summary fallback */ } finally { setDigestBusy(false); }
  }

  async function generateBrief() {
    setDigestBusy(true);
    try { await api.runBrief(); await api.briefDigest(true); await load(); }
    catch (e) { setError(e.message); } finally { setDigestBusy(false); }
  }

  async function checkin(goalId) {
    setChecking((c) => ({ ...c, [goalId]: true }));
    try { await api.checkinGoal(goalId, { status: 'done' }); await load(); }
    catch (e) { setError(e.message); } finally { setChecking((c) => ({ ...c, [goalId]: false })); }
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

  const go = (view) => onNavigate && onNavigate(view);
  const alerts = data?.alerts || [];
  const agenda = data?.agenda || { goals: [], calendar: [], jobDeadlines: [] };
  const agents = data?.agents || [];
  const brief = data?.brief || {};
  const feed = data?.feed || [];

  const projectCount = feed.filter((f) => f.agent === 'project').length;
  const visibleFeed = feed.filter((f) =>
    filter === 'all' ? (showArchivist || f.agent !== 'project') : f.agent === filter);

  return (
    <div className="view active">
      <div className="digest-header">
        <span className="digest-time">{time}</span>
        <span className="digest-date">{fullDate()}</span>
      </div>

      {/* ZONE 1 — alert strip (hidden when nothing is urgent) */}
      {alerts.length > 0 && (
        <div className="alert-strip">
          <span className="alert-tag">needs you</span>
          <div className="alert-items">
            {alerts.map((a, i) => (
              <button key={i} className="alert-item" onClick={() => go(a.view)}>
                <span className="alert-dot" style={{ background: AGENT_COLOR[a.agent] || 'var(--text-dim)' }} />
                {a.text}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="home-cols">
        {/* ZONE 2 — today's agenda */}
        <div className="card home-agenda">
          <div className="card-title">today</div>

          <div className="agenda-section">goals</div>
          {agenda.goals.length === 0 && <p className="agenda-empty">No active goals — add one in Goals.</p>}
          <div className="agenda-goals">
            {agenda.goals.map((g) => {
              const st = STATUS_STYLE[g.status] || STATUS_STYLE.due;
              return (
                <div className="agenda-goal" key={g.id}>
                  <span className="agenda-goal-name">{g.title}</span>
                  {g.streak > 0 && <span className="agenda-goal-streak">🔥{g.streak}</span>}
                  {g.status === 'done'
                    ? <span className="status-pill" style={{ color: st.color, borderColor: st.color }}>done</span>
                    : (
                      <button className="checkin-btn" disabled={checking[g.id]} onClick={() => checkin(g.id)}>
                        {checking[g.id] ? '…' : 'check in'}
                      </button>
                    )}
                </div>
              );
            })}
          </div>

          <div className="agenda-section">calendar</div>
          <MiniCalendar events={events} />

          {agenda.jobDeadlines.length > 0 && <>
            <div className="agenda-section">job deadlines</div>
            {agenda.jobDeadlines.map((e) => (
              <div className="agenda-event" key={e.id}>
                <span className="agenda-event-time" style={{ color: 'var(--job)' }}>{e.due}</span>
                <span className="agenda-event-title">{e.title}</span>
              </div>
            ))}
          </>}
        </div>

        {/* ZONE 3 — morning brief digest */}
        <div className="card home-digest">
          <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>morning brief</div>
            {brief.hasBriefToday && (
              <button className="btn" style={{ fontSize: 11, padding: '5px 12px' }} disabled={digestBusy} onClick={() => ensureDigest(true)}>
                {digestBusy ? 'synthesizing…' : 'refresh'}
              </button>
            )}
          </div>

          {!brief.hasBriefToday ? (
            <div className="digest-empty">
              <p className="text-sm" style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
                No brief has run today yet.
              </p>
              <button className="btn btn-primary" disabled={digestBusy} onClick={generateBrief}>
                {digestBusy ? 'curating…' : 'generate brief'}
              </button>
            </div>
          ) : (
            <div className="digest-scroll">
              {brief.digest
                ? brief.digest.split(/\n+/).map((s) => s.trim()).filter(Boolean).map((para, i) => (
                    <p className="digest-para" key={i}>{renderRich(para)}</p>
                  ))
                : <p className="digest-para">{digestBusy ? 'Synthesizing your morning…' : brief.summary}</p>}
              {brief.itemCount > 0 && (
                <button className="digest-toggle" onClick={() => setBriefOpen((v) => !v)}>
                  {briefOpen ? '▾ hide stories' : `▸ read more · ${brief.itemCount} stor${brief.itemCount === 1 ? 'y' : 'ies'}`}
                </button>
              )}
              {briefOpen && brief.items.map((it) => (
                <a className="article-item" key={it.id} href={it.source_url || '#'} target="_blank" rel="noreferrer"
                  style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="flex-1">
                    {it.topic && <div className="article-source">{it.topic}</div>}
                    <div className="article-title">{it.headline}</div>
                    <div className="article-read">{readMin(it.summary)} min read</div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* ZONE 4 — agent feed */}
        <div className="card home-feed">
          <div className="card-title">agent feed</div>
          <div className="feed-filters">
            {FEED_FILTERS.map((f) => (
              <button key={f.key} className={`feed-filter ${filter === f.key ? 'active' : ''}`}
                onClick={() => setFilter(f.key)}>{f.label}</button>
            ))}
          </div>

          <div className="feed-scroll">
            {filter === 'all' && projectCount > 0 && (
              <button className="archivist-toggle" onClick={() => setShowArchivist((v) => !v)}>
                {showArchivist ? 'hide project updates' : `show ${projectCount} project update${projectCount === 1 ? '' : 's'}`}
              </button>
            )}
            {visibleFeed.length === 0 && (
              <p className="agenda-empty">No activity{filter === 'all' ? ' yet' : ` from ${filter}`}.</p>
            )}
            {visibleFeed.map((f, i) => (
              <div className="feed-item" key={i}>
                <div className="feed-bar" style={{ background: AGENT_COLOR[f.agent] || 'var(--text-dim)' }} />
                <div className="feed-body">
                  <div className="feed-text">{f.text}</div>
                  <div className="feed-meta">{ago(f.at)} · {f.agent}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ZONE 5 — agent health row */}
      <div className="health-row">
        {agents.map((a) => (
          <button className="health-card" key={a.key} onClick={() => go(a.view)}>
            <div className="health-head">
              <span className="health-name" style={{ color: AGENT_COLOR[a.key] }}>{a.name}</span>
              <span className={`agent-dot ${a.dot}`} />
            </div>
            <div className="health-insight">{a.insight}</div>
            <div className="health-runs">
              <span>{a.lastRun ? `ran ${ago(a.lastRun)}` : 'not run yet'}</span>
              <span>next {nextLabel(a.nextRun)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
