import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// ── shared helpers ───────────────────────────────────────────────────────────
function parseTs(ts) {
  if (!ts) return null;
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const evTime = (ts, allDay) => allDay ? 'all day' : (parseTs(ts)?.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) || '');
function fmtDate(ts) {
  const d = parseTs(ts); if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// per-source accent + label for an event's origin
const SOURCE = {
  email: { color: 'var(--email)', label: 'email agent' },
  job: { color: 'var(--job)', label: 'job agent' },
  accountability: { color: 'var(--acct)', label: 'accountability' },
  user: { color: 'var(--accent)', label: 'manual' },
};
const IMPORTANCE = { urgent: 'var(--danger)', important: 'var(--warn)', normal: 'var(--text-secondary)', noise: 'var(--text-dim)' };
const INSIGHT_COLOR = { deadline: 'var(--danger)', urgent: 'var(--danger)', job: 'var(--job)', action: 'var(--job)', info: 'var(--text-secondary)' };
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FILTERS = ['all', 'urgent', 'important', 'job-alert', 'newsletter', 'noise'];

// ── left panel: full month calendar grid ─────────────────────────────────────
function MonthGrid({ events }) {
  const now = new Date();
  const [view, setView] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [selected, setSelected] = useState(dayKey(now));

  const byDay = {};
  for (const e of events) { const d = parseTs(e.start_at); if (d) (byDay[dayKey(d)] ||= []).push(e); }

  const year = view.getFullYear(), month = view.getMonth();
  const startPad = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const todayKey = dayKey(now);
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));

  const shift = (n) => { setSelected(null); setView(new Date(year, month + n, 1)); };
  const selEvents = selected ? (byDay[selected] || []) : [];

  return (
    <div className="cal-grid-wrap">
      <div className="cal-grid-head">
        <button className="cal-nav" onClick={() => shift(-1)} aria-label="previous month">‹</button>
        <span className="cal-month">{view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
        <button className="cal-nav" onClick={() => shift(1)} aria-label="next month">›</button>
      </div>
      <div className="cal-grid">
        {WEEKDAYS.map((w) => <div key={w} className="cal-wd">{w[0]}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} className="cal-cell empty" />;
          const k = dayKey(d);
          const evs = byDay[k] || [];
          return (
            <button key={k} className={`cal-cell${k === todayKey ? ' today' : ''}${k === selected ? ' sel' : ''}`}
              onClick={() => setSelected(k)}>
              <span className="cal-date">{d.getDate()}</span>
              <span className="cal-chips">
                {evs.slice(0, 3).map((e, j) => (
                  <span key={j} className="cal-chip" style={{ background: (SOURCE[e.source_agent] || SOURCE.user).color }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="cal-day-panel">
        <div className="cal-day-title">
          {selected ? new Date(`${selected}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : 'select a day'}
        </div>
        {selected && selEvents.length === 0 && <div className="cal-day-empty">No events.</div>}
        {selEvents.map((e) => {
          const s = SOURCE[e.source_agent] || SOURCE.user;
          return (
            <div className="cal-day-event" key={e.id} style={{ borderLeftColor: s.color }}>
              <div className="cal-day-event-time">{evTime(e.start_at, e.all_day)}</div>
              <div className="cal-day-event-title">{e.title}</div>
              <div className="cal-day-event-src" style={{ color: s.color }}>{s.label}</div>
            </div>
          );
        })}
      </div>

      <div className="cal-legend">
        {['email', 'job', 'user'].map((s) => (
          <span key={s} className="cal-legend-item"><span className="cal-chip" style={{ background: SOURCE[s].color }} />{SOURCE[s].label}</span>
        ))}
      </div>
    </div>
  );
}

// ── middle panel: paginated, filterable inbox ────────────────────────────────
function Inbox({ counts, onChange }) {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ flags: [], total: 0, pages: 1, page: 1 });
  const [open, setOpen] = useState(null);

  useEffect(() => {
    api.emailInbox({ filter, page, pageSize: 25 }).then(setData).catch(() => {});
  }, [filter, page, onChange]);

  const pick = (f) => { setFilter(f); setPage(1); setOpen(null); };

  return (
    <>
      <div className="inbox-tabs">
        {FILTERS.map((f) => (
          <button key={f} className={`inbox-tab${filter === f ? ' active' : ''}`} onClick={() => pick(f)}>
            {f}{counts[f] != null && <span className="inbox-tab-n">{counts[f]}</span>}
          </button>
        ))}
      </div>

      <div className="inbox-list">
        {data.flags.length === 0 && <p className="cal-day-empty" style={{ padding: '12px 0' }}>No emails in this view.</p>}
        {data.flags.map((f) => {
          const isOpen = open === f.id;
          const action = f.action_taken ? f.action_taken.replace('updated_job_status:', 'flipped job → ') : null;
          return (
            <div key={f.id} className={`mail-row${isOpen ? ' open' : ''}`}>
              <button className="mail-head" onClick={() => setOpen(isOpen ? null : f.id)}>
                <span className="mail-dot" style={{ background: IMPORTANCE[f.importance] }} />
                <span className="mail-main">
                  <span className="mail-sender">{f.sender || '(unknown)'}</span>
                  <span className="mail-subject">{f.subject || '(no subject)'}</span>
                </span>
                <span className="mail-meta">
                  {f.category && <span className="mail-badge">{f.category}</span>}
                  {action && <span className="mail-badge act">{action}</span>}
                  {f.deadline_at && <span className="mail-badge act">deadline {fmtDate(f.deadline_at)}</span>}
                  <span className="mail-imp" style={{ color: IMPORTANCE[f.importance] }}>{f.importance}</span>
                  <span className="mail-date">{fmtDate(f.received_at)}</span>
                </span>
              </button>
              {isOpen && (
                <div className="mail-detail">
                  {f.snippet && <p className="mail-snippet">{f.snippet}</p>}
                  <div className="mail-facts">
                    <span><b>importance</b> {f.importance}</span>
                    <span><b>category</b> {f.category || '—'}</span>
                    <span><b>from</b> {f.sender_email || f.sender || '—'}</span>
                    {f.deadline_at && <span><b>deadline</b> {fmtDate(f.deadline_at)}</span>}
                    <span><b>action</b> {action || 'none'}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filter === 'all' && counts.noise > 0 && (
          <button className="noise-toggle" onClick={() => pick('noise')}>show {counts.noise} noise emails →</button>
        )}
      </div>

      <div className="inbox-pager">
        <button className="btn" style={pagerBtn} disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>‹ prev</button>
        <span className="inbox-pageinfo">{data.total ? `${data.page} / ${data.pages} · ${data.total} emails` : '—'}</span>
        <button className="btn" style={pagerBtn} disabled={data.page >= data.pages} onClick={() => setPage((p) => p + 1)}>next ›</button>
      </div>
    </>
  );
}
const pagerBtn = { fontSize: 11, padding: '4px 10px' };

// ── the view: three resizable panels ─────────────────────────────────────────
export default function CalendarView() {
  const [events, setEvents] = useState([]);
  const [counts, setCounts] = useState({});
  const [insights, setInsights] = useState([]);
  const [gmail, setGmail] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);                  // bumps to refetch inbox
  const [cols, setCols] = useState([34, 33, 33]);       // panel widths (%)
  const wrapRef = useRef(null);
  const drag = useRef(null);

  function load() {
    api.calendar(true).then((r) => setEvents(r.events || [])).catch((e) => setError(e.message));
    api.emailCounts().then((r) => setCounts(r.counts || {})).catch(() => {});
    api.emailInsights().then((r) => setInsights(r.insights || [])).catch(() => {});
    api.emailStatus().then(setGmail).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  async function scanInbox() {
    setBusy(true);
    try { await api.runEmail(); load(); setTick((t) => t + 1); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  // draggable dividers: divider 0 splits cols[0]/cols[1], divider 1 splits [1]/[2]
  function startDrag(idx, e) {
    e.preventDefault();
    const w = wrapRef.current?.clientWidth || 1;
    drag.current = { idx, x: e.clientX, w, cols: [...cols] };
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', endDrag);
  }
  function onDrag(e) {
    const d = drag.current; if (!d) return;
    const deltaPct = ((e.clientX - d.x) / d.w) * 100;
    const next = [...d.cols];
    const [a, b] = [d.idx, d.idx + 1];
    next[a] = Math.max(16, d.cols[a] + deltaPct);
    next[b] = Math.max(16, d.cols[b] - deltaPct);
    if (next[a] >= 16 && next[b] >= 16) setCols(next);
  }
  function endDrag() {
    drag.current = null;
    window.removeEventListener('pointermove', onDrag);
    window.removeEventListener('pointerup', endDrag);
  }

  if (error) {
    return (
      <div className="view active">
        <div className="card">
          <div className="card-title">couldn't reach the backend</div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error}. Is the Nexus server running on <code>localhost:3001</code>?</p>
        </div>
      </div>
    );
  }
  const notReady = gmail && !gmail.ready;

  return (
    <div className="view active" style={{ gap: 12 }}>
      <div className="cal-topbar">
        <div className="cal-topbar-title">calendar &amp; email <span style={{ color: 'var(--text-dim)' }}>· {counts.total ?? 0} triaged</span></div>
        <button className="btn" style={{ fontSize: 11, padding: '5px 12px' }} disabled={busy || notReady} onClick={scanInbox}>
          {busy ? 'scanning…' : '↻ scan inbox'}
        </button>
      </div>

      {notReady && (
        <div className="card" style={{ borderColor: 'rgba(240,160,80,0.3)', flexShrink: 0 }}>
          <div className="card-title">connect Gmail (read-only)</div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {gmail.reason === 'NO_CREDENTIALS'
              ? <>Add OAuth Desktop credentials to <code>server/credentials.json</code>, then run <code>npm run gmail:auth</code> in <code>server/</code>.</>
              : <>Gmail credentials found — run <code>npm run gmail:auth</code> in <code>server/</code> once to authorize read-only access.</>}
          </p>
        </div>
      )}

      <div className="tri-panel" ref={wrapRef}>
        <section className="tri-col" style={{ width: `${cols[0]}%` }}>
          <div className="tri-title">calendar</div>
          <div className="tri-body"><MonthGrid events={events} /></div>
        </section>
        <div className="tri-divider" onPointerDown={(e) => startDrag(0, e)} />

        <section className="tri-col" style={{ width: `${cols[1]}%` }}>
          <div className="tri-title">inbox</div>
          <div className="tri-body inbox-body"><Inbox counts={counts} onChange={tick} /></div>
        </section>
        <div className="tri-divider" onPointerDown={(e) => startDrag(1, e)} />

        <section className="tri-col" style={{ width: `${cols[2]}%` }}>
          <div className="tri-title">agent rail <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>· what the email agent noticed</span></div>
          <div className="tri-body">
            {insights.length === 0 && <p className="cal-day-empty">No insights yet — run a scan.</p>}
            {insights.map((it, i) => (
              <div className="insight-card" key={i} style={{ borderLeftColor: INSIGHT_COLOR[it.kind] || 'var(--text-dim)' }}>
                <span className="insight-kind" style={{ color: INSIGHT_COLOR[it.kind] || 'var(--text-dim)' }}>{it.kind}</span>
                <p className="insight-text">{it.text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
