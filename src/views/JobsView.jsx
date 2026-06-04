import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';

// Match % color tiers — mirrors master.html (success for high, blue mid).
function matchColor(pct) {
  if (pct >= 85) return 'var(--success)';
  if (pct >= 70) return 'var(--email)';
  if (pct >= 50) return 'var(--warn)';
  return 'var(--text-secondary)';
}

// Status -> badge label + colors. Built on the badge styles in master.html.
const STATUS_BADGE = {
  new: { label: 'Not applied', bg: 'var(--bg-raised)', color: 'var(--text-secondary)' },
  applied: { label: 'Applied', bg: 'rgba(240,160,80,0.15)', color: 'var(--warn)' },
  interviewing: { label: 'Interview', bg: 'var(--accent-dim)', color: 'var(--accent)' },
  offer: { label: 'Offer', bg: 'rgba(78,203,168,0.15)', color: 'var(--success)' },
  rejected: { label: 'Rejected', bg: 'rgba(224,91,91,0.15)', color: 'var(--danger)' },
  withdrawn: { label: 'Withdrawn', bg: 'var(--bg-raised)', color: 'var(--text-dim)' },
  archived: { label: 'Archived', bg: 'var(--bg-raised)', color: 'var(--text-dim)' },
};

function StatusBadge({ status }) {
  const s = STATUS_BADGE[status] || STATUS_BADGE.new;
  return <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

function LevelTag({ level }) {
  return level === 'Entry'
    ? <span className="tag" style={{ background: 'var(--job-dim)', color: 'var(--job)' }}>Entry</span>
    : <span className="tag" style={{ background: 'rgba(240,160,80,0.12)', color: 'var(--warn)' }}>Stretch</span>;
}

// The application tracker timeline: applied -> screen -> interview -> offer.
const STEPS = ['applied', 'screen', 'interview', 'offer'];
const STATUS_STEP = { applied: 0, interviewing: 2, offer: 3, withdrawn: 0 };

function Timeline({ status }) {
  const current = STATUS_STEP[status] ?? 0;
  const nodes = [];
  STEPS.forEach((label, i) => {
    const cls = i < current ? 'done' : i === current ? 'current' : '';
    nodes.push(
      <div className="track-step" key={label}>
        <div className={`track-node ${cls}`.trim()} />
        <div className="track-label">{label}</div>
      </div>
    );
    if (i < STEPS.length - 1) {
      nodes.push(<div className={`track-line ${i < current ? 'done' : ''}`.trim()} key={`line-${i}`} />);
    }
  });
  return <div className="track-timeline">{nodes}</div>;
}

const FILTERS = [
  { key: 'all', label: 'all tracks' },
  { key: 'entry', label: 'entry only' },
  { key: 'applied', label: 'applied' },
];

export default function JobsView() {
  const [stats, setStats] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [apps, setApps] = useState([]);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Run state for the "run now" button.
  const [run, setRun] = useState(null);   // latest server run-state
  const [runErr, setRunErr] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0); // bump to reload the board after a run
  const pollRef = useRef(null);
  const running = run?.running === true;

  // stats + applications load on mount and after each completed run.
  useEffect(() => {
    Promise.all([api.jobStats(), api.jobApplications()])
      .then(([s, a]) => { setStats(s); setApps(a.applications); })
      .catch((e) => setError(e.message));
  }, [refreshKey]);

  // listings reload on filter change and after each completed run.
  useEffect(() => {
    setLoading(true);
    const params = { limit: 100 };
    if (filter === 'entry') params.entry = '1';
    if (filter === 'applied') params.status = 'applied';
    api.jobs(params)
      .then((r) => setJobs(r.jobs))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filter, refreshKey]);

  // Poll run status while a run is in flight; refresh the board when it ends.
  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const state = await api.jobRunStatus();
        setRun(state);
        if (!state.running) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          if (state.error) setRunErr(state.error);
          setRefreshKey((k) => k + 1); // pull the freshly written jobs
        }
      } catch (e) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setRunErr(e.message);
      }
    }, 2500);
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function handleRun() {
    setRunErr(null);
    try {
      const res = await api.runJob();
      setRun(res.state || { running: true, step: 'starting' });
      startPolling();
    } catch (e) {
      setRunErr(e.message); // e.g. ANTHROPIC_API_KEY not set, or already running
    }
  }

  const statCards = useMemo(() => ([
    { value: stats?.total ?? '—', label: 'total listings', color: 'var(--job)' },
    { value: stats?.entry ?? '—', label: 'entry level fit', color: 'var(--success)' },
    { value: stats?.applied ?? '—', label: 'applied', color: 'var(--warn)' },
    { value: stats?.interviews ?? '—', label: 'interviews', color: 'var(--accent)' },
  ]), [stats]);

  if (error) {
    return (
      <div className="view active">
        <div className="card">
          <div className="card-title">couldn't reach the backend</div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {error}. Is the Nexus server running on <code>localhost:3001</code>? Start it with
            <code> cd server &amp;&amp; npm run dev</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="view active">
      {/* stat cards */}
      <div className="stat-grid">
        {statCards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="stat-value" style={{ color: c.color }}>{c.value}</div>
            <div className="stat-label">{c.label}</div>
          </div>
        ))}
      </div>

      {/* listings */}
      <div className="card">
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            all listings {loading ? '· …' : `· ${jobs.length} shown`}
          </div>
          <div className="flex gap-2 items-center">
            {FILTERS.map((f) => (
              <span
                key={f.key}
                className="tag"
                onClick={() => setFilter(f.key)}
                style={{
                  cursor: 'pointer',
                  background: filter === f.key ? 'var(--job-dim)' : 'var(--bg-raised)',
                  color: filter === f.key ? 'var(--job)' : 'var(--text-secondary)',
                }}
              >
                {f.label}
              </span>
            ))}
            <button className="btn btn-primary" onClick={handleRun} disabled={running}>
              {running ? `running · ${run?.step || '…'}` : '↻ run now'}
            </button>
          </div>
        </div>

        {/* run feedback: error, in-flight step, or last-run summary */}
        {runErr && (
          <div className="text-xs" style={{ color: 'var(--danger)', marginBottom: 10 }}>
            {runErr}
          </div>
        )}
        {!runErr && !running && run?.summary && (
          <div className="text-xs" style={{ color: 'var(--text-secondary)', marginBottom: 10 }}>
            last run · {run.summary.written} written · {run.summary.matches} matches ·
            {' '}{run.summary.entryFit} entry fit · {run.summary.elapsedSec}s
          </div>
        )}
        <table className="job-table">
          <thead>
            <tr>
              <th>company</th><th>role</th><th>location</th><th>match</th><th>level</th><th>status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const pct = Math.round(j.matchScore ?? 0);
              const color = matchColor(pct);
              return (
                <tr key={j.id}>
                  <td><div className="job-company">{j.company}</div></td>
                  <td className="job-title-cell">{j.title}</td>
                  <td className="text-mono text-xs">{j.location || '—'}</td>
                  <td>
                    <div className="match-cell">
                      <span className="match-pct" style={{ color }}>{pct}%</span>
                      <div className="match-mini">
                        <div className="match-mini-fill" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  </td>
                  <td><LevelTag level={j.level} /></td>
                  <td><StatusBadge status={j.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* application tracker */}
      <div className="card">
        <div className="card-title">application tracker</div>
        {apps.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            No applications yet — statuses will populate here as you apply (and once the email agent starts updating them).
          </p>
        ) : (
          apps.slice(0, 10).map((a) => (
            <div style={{ marginBottom: 12 }} key={a.id}>
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{a.company} — {a.title}</span>
                <StatusBadge status={a.status} />
              </div>
              <Timeline status={a.status} />
            </div>
          ))
        )}
        {apps.length > 10 && (
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>+{apps.length - 10} more</p>
        )}
      </div>
    </div>
  );
}
