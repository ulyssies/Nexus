import { useEffect, useState } from 'react';
import { api } from '../api.js';

function fmtWhen(ts, allDay) {
  if (!ts) return '';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return allDay ? `${date} · all day` : `${date} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

// per-source accent + label for an event's origin
const SOURCE = {
  email: { color: 'var(--email)', label: 'synced by email agent' },
  job: { color: 'var(--job)', label: 'job agent' },
  accountability: { color: 'var(--acct)', label: 'accountability' },
  user: { color: 'var(--accent)', label: 'you' },
};

const IMPORTANCE = {
  urgent: 'var(--danger)', important: 'var(--warn)', normal: 'var(--text-secondary)', noise: 'var(--text-dim)',
};

export default function CalendarView() {
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [flags, setFlags] = useState([]);
  const [gmail, setGmail] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.calendar().then((r) => setEvents(r.events)).catch((e) => setError(e.message));
    api.emailStats().then(setStats).catch(() => {});
    api.emailFlags().then((r) => setFlags(r.flags)).catch(() => {});
    api.emailStatus().then(setGmail).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  async function scanInbox() {
    setBusy(true);
    try { await api.runEmail(); load(); }
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

  const notReady = gmail && !gmail.ready;

  return (
    <div className="view active">
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--email)' }}>{stats?.total ?? '—'}</div><div className="stat-label">emails triaged</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--danger)' }}>{stats?.urgent ?? '—'}</div><div className="stat-label">urgent</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--warn)' }}>{stats?.unread ?? '—'}</div><div className="stat-label">unread</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: 'var(--accent)' }}>{stats?.deadlines ?? '—'}</div><div className="stat-label">deadlines</div></div>
      </div>

      {notReady && (
        <div className="card" style={{ borderColor: 'rgba(240,160,80,0.3)' }}>
          <div className="card-title">connect Gmail (read-only)</div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {gmail.reason === 'NO_CREDENTIALS'
              ? <>Add OAuth Desktop credentials to <code>server/credentials.json</code> (Google Cloud → enable Gmail API), then run <code>npm run gmail:auth</code> in <code>server/</code>.</>
              : <>Gmail credentials found — run <code>npm run gmail:auth</code> in <code>server/</code> once to authorize read-only access.</>}
          </p>
        </div>
      )}

      <div className="cal-layout">
        <div className="card">
          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>upcoming</div>
            <button className="btn" style={{ fontSize: 11, padding: '5px 12px' }} disabled={busy || notReady} onClick={scanInbox}>
              {busy ? 'scanning…' : 'scan inbox'}
            </button>
          </div>
          <div className="event-list">
            {events.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
                Nothing scheduled. The email agent adds deadlines here as it finds them.
              </p>
            )}
            {events.map((e) => {
              const src = SOURCE[e.source_agent] || SOURCE.user;
              return (
                <div className="event-item" key={e.id} style={{ borderLeftColor: src.color }}>
                  <div className="event-title">{e.title}</div>
                  <div className="event-time">{fmtWhen(e.start_at, e.all_day)}</div>
                  <div className="event-agent" style={{ color: src.color }}>{src.label}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-title">inbox · triaged</div>
          {flags.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No emails triaged yet.</p>
          )}
          {flags.slice(0, 12).map((f) => (
            <div className="event-item" key={f.id} style={{ borderLeftColor: IMPORTANCE[f.importance] || 'var(--text-dim)' }}>
              <div className="event-title">{f.subject || '(no subject)'}</div>
              <div className="event-time">{f.sender}{f.category ? ` · ${f.category}` : ''}</div>
              <div className="flex items-center" style={{ gap: 6 }}>
                <span className="badge" style={{ background: 'var(--bg-raised)', color: IMPORTANCE[f.importance] }}>{f.importance}</span>
                {f.action_taken && <span className="badge" style={{ background: 'var(--job-dim)', color: 'var(--job)' }}>{f.action_taken.replace('updated_job_status:', 'job → ')}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
