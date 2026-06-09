import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';

const PAGE_SIZE = 50;
const SCORE_PRESETS = [
  { value: '', label: 'all scores' },
  { value: '70', label: '70%+' },
  { value: '80', label: '80%+' },
  { value: '85', label: '85%+' },
];

function matchColor(pct) {
  if (pct >= 85) return 'var(--success)';
  if (pct >= 70) return 'var(--email)';
  if (pct >= 50) return 'var(--warn)';
  return 'var(--text-secondary)';
}

const STATUS_BADGE = {
  new: { label: 'Not applied', bg: 'var(--bg-raised)', color: 'var(--text-secondary)' },
  interested: { label: 'Interested', bg: 'var(--job-dim)', color: 'var(--job)' },
  applied: { label: 'Applied', bg: 'rgba(240,160,80,0.15)', color: 'var(--warn)' },
  interviewing: { label: 'Interview', bg: 'var(--accent-dim)', color: 'var(--accent)' },
  offer: { label: 'Offer', bg: 'rgba(78,203,168,0.15)', color: 'var(--success)' },
  rejected: { label: 'Rejected', bg: 'rgba(224,91,91,0.15)', color: 'var(--danger)' },
  withdrawn: { label: 'Withdrawn', bg: 'var(--bg-raised)', color: 'var(--text-dim)' },
  archived: { label: 'Archived', bg: 'var(--bg-raised)', color: 'var(--text-dim)' },
};

const STATUS_OPTIONS = [
  { value: 'new', label: 'Not applied' },
  { value: 'interested', label: 'Interested' },
  { value: 'applied', label: 'Applied' },
  { value: 'interviewing', label: 'Interviewing' },
  { value: 'offer', label: 'Offer' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'archived', label: 'Archived' },
];

const LEVEL_STYLE = {
  entry: { bg: 'var(--job-dim)', color: 'var(--job)' },
  mid: { bg: 'rgba(91,156,246,0.12)', color: 'var(--email)' },
  senior: { bg: 'rgba(240,160,80,0.12)', color: 'var(--warn)' },
};

const STEPS = ['applied', 'screen', 'interview', 'offer'];
const STATUS_STEP = { interested: 0, applied: 0, interviewing: 2, offer: 3, rejected: 0, withdrawn: 0, archived: 0 };

// The Live tracker is strictly things you've ACTUALLY applied to and are still
// pursuing. "interested" is a pre-application shortlist (lives on the Found
// side), and rejected/withdrawn/archived are closed-out (the Inactive tab).
const ACTIVE_APP_STATUSES = new Set(['applied', 'interviewing', 'offer']);
const INACTIVE_STATUSES = new Set(['rejected', 'withdrawn', 'archived']);

// "Ghosted": you applied but heard nothing back in 30 days. Derived (not a real
// status) so it auto-clears if the company finally responds and advances it.
const GHOST_DAYS = 30;
function daysSince(ts) {
  if (!ts) return Infinity;
  const d = new Date(String(ts).includes('T') ? ts : String(ts).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? Infinity : (Date.now() - d.getTime()) / 86400000;
}
const isGhosted = (a) => a.status === 'applied' && daysSince(a.appliedAt || a.statusUpdatedAt) >= GHOST_DAYS;

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatFullDate(value) {
  if (!value) return 'Not available';
  const d = new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatusBadge({ job }) {
  const s = STATUS_BADGE[job.status] || STATUS_BADGE.new;
  const appliedDate = job.appliedAt || job.statusUpdatedAt;
  const label = job.status === 'applied' && appliedDate ? `Applied ${formatDate(appliedDate)}` : s.label;
  return <span className="badge" style={{ background: s.bg, color: s.color }}>{label}</span>;
}

function StatusSelect({ job, onChange, disabled }) {
  return (
    <label className="status-control">
      <span>status</span>
      <select value={job.status || 'new'} disabled={disabled} onChange={(e) => onChange(job.id, e.target.value)}>
        {STATUS_OPTIONS.map((option) => (
          <option value={option.value} key={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function LevelTag({ job }) {
  const key = job.levelKey || 'mid';
  const style = LEVEL_STYLE[key] || LEVEL_STYLE.mid;
  return <span className="tag" style={{ background: style.bg, color: style.color }}>{job.level || key}</span>;
}

function Timeline({ status }) {
  const current = STATUS_STEP[status] ?? 0;
  const progress = Math.max(0, Math.min(current, STEPS.length - 1)) / (STEPS.length - 1);
  return (
    <div className="track-timeline" style={{ '--track-progress': progress }}>
      <div className="track-rail" />
      <div className="track-rail-fill" />
      {STEPS.map((label, i) => {
        const cls = i < current ? 'done' : i === current ? 'current' : '';
        return (
      <div className="track-step" key={label}>
        <div className={`track-node ${cls}`.trim()} />
        <div className="track-label">{label}</div>
      </div>
        );
      })}
    </div>
  );
}

function DetailTags({ label, items, tone = 'neutral', empty = 'None stored yet' }) {
  const list = Array.isArray(items) && items.length ? items : [empty];
  const style = tone === 'positive'
    ? { background: 'var(--job-dim)', color: 'var(--job)' }
    : tone === 'negative'
      ? { background: 'rgba(224,91,91,0.12)', color: 'var(--danger)' }
      : { background: 'var(--bg-raised)', color: 'var(--text-secondary)' };
  return (
    <div className="job-skill-block">
      <span>{label}</span>
      {list.map((item) => (
        <span className="tag" key={item} style={style}>{item}</span>
      ))}
    </div>
  );
}

function RoleDescription({ job }) {
  // The listing's own description text (what the agent scored against) — no
  // extra Claude tokens spent generating a summary.
  const text = (job.description || '').trim()
    || (job.roleSummary || '').trim();   // fall back to legacy rows' generated summary
  return (
    <div className="role-description">
      {text
        ? <p className="job-description" style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>{text}</p>
        : <p className="job-description text-dim">No description was provided for this listing.</p>}
    </div>
  );
}

function filterParams(filters, sort) {
  const params = { limit: 5000, sort };
  if (filters.track !== 'all') params.track = filters.track;
  if (filters.level !== 'all') params.level = filters.level;
  if (filters.status !== 'all') params.status = filters.status;
  if (filters.city !== 'all') params.city = filters.city;
  if (filters.minScore) params.minScore = filters.minScore;
  return params;
}

function groupRows(jobs, expandedCompanies, sort) {
  // Company folders only make sense when sorting BY company. In newest/match
  // views, grouping would bury the most recent listings under a few big
  // companies — so keep those views flat and let the newest jobs surface.
  if (sort !== 'company') return jobs.map((job) => ({ type: 'job', job }));

  const stats = new Map();
  for (const job of jobs) {
    const current = stats.get(job.company) || { count: 0, highest: 0, jobs: [] };
    current.count += 1;
    current.highest = Math.max(current.highest, Math.round(job.matchScore || 0));
    current.jobs.push(job);
    stats.set(job.company, current);
  }

  const rows = [];
  const seen = new Set();
  for (const job of jobs) {
    const group = stats.get(job.company);
    if (group?.count >= 5) {
      if (seen.has(job.company)) continue;
      seen.add(job.company);
      rows.push({ type: 'company', company: job.company, count: group.count, highest: group.highest });
      if (expandedCompanies.has(job.company)) {
        rows.push(...group.jobs.map((j) => ({ type: 'job', job: j, grouped: true })));
      }
      continue;
    }
    rows.push({ type: 'job', job });
  }
  return rows;
}

function JobDetail({ job, onClose, onApplied, onStatusChange, applying, updatingStatus }) {
  const pct = Math.round(job.matchScore || 0);
  const color = matchColor(pct);
  const canApply = !['applied', 'interviewing', 'offer'].includes(job.status);
  const missingSkills = job.missingSkills || [];
  return (
    <tr className="job-detail-row" data-job-panel>
      <td colSpan="7">
        <div className="job-detail-panel">
          <button className="job-detail-close" onClick={onClose} aria-label="Close job details">x</button>

          <div className="job-detail-head">
            <div>
              <div className="job-detail-title">{job.title}</div>
              <div className="job-detail-meta">
                {job.company} · {job.location || 'Location not listed'} · posted {formatFullDate(job.postedAt || job.addedAt)}
              </div>
            </div>
            <div className="job-detail-score" style={{ color }}>
              {pct}%
              <span>{job.matchCategory || 'match'}</span>
            </div>
          </div>

          <div className="job-detail-grid">
            <div className="job-detail-section">
              <div className="card-title">description</div>
              <RoleDescription job={job} />
            </div>

            <div className="job-detail-section">
              <div className="card-title">why this fit</div>
              <p className="job-description">{job.reason || 'No score reasoning was stored for this listing.'}</p>
              <DetailTags label="missing skills" items={missingSkills} tone="negative" empty="None flagged" />
            </div>
          </div>

          <div className="job-detail-facts">
            <span><strong>Company</strong>{job.company}</span>
            <span><strong>Location</strong>{job.location || '-'}</span>
            <span><strong>Salary</strong>{job.salary || 'Not listed'}</span>
            <span><strong>Source</strong>{job.source || '-'}</span>
          </div>

          <div className="job-detail-actions">
            {job.url && <a className="btn" href={job.url} target="_blank" rel="noreferrer">open listing</a>}
            <StatusSelect job={job} onChange={onStatusChange} disabled={updatingStatus} />
            <button className="btn btn-primary" disabled={!canApply || applying} onClick={() => onApplied(job.id)}>
              {job.status === 'applied' ? 'already applied' : applying ? 'saving...' : 'Mark as Applied'}
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// Shared renderer for both the live and inactive application trackers. For
// inactive (closed-out) apps the progress timeline is meaningless, so the
// middle column shows a plain "closed" note instead.
function ApplicationTracker({ title, subtitle, list, emptyText, onStatusChange, updatingStatusId, inactive = false }) {
  return (
    <div className="card application-tracker-card">
      <div className="job-board-head">
        <div>
          <div className="card-title" style={{ marginBottom: 2 }}>{title}</div>
          <div className="text-xs text-dim">{subtitle}</div>
        </div>
      </div>
      <div className="application-list">
      {list.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{emptyText}</p>
      ) : (
        list.map((a) => (
          <div className="application-row" key={a.id}>
            <div className="application-title">
              <span>{a.company || 'Unknown company'} - {a.title || 'Untitled role'}</span>
              {a._ghosted
                ? <span className="badge" style={{ background: 'var(--bg-raised)', color: 'var(--warn)' }}>Ghosted</span>
                : <StatusBadge job={a} />}
            </div>
            {inactive
              ? <div className="text-xs text-dim" style={{ textTransform: 'capitalize' }}>
                  {a._ghosted ? 'ghosted · no reply in 30 days' : `closed · ${a.status}`}
                </div>
              : <Timeline status={a.status} />}
            <div className="application-actions">
              <StatusSelect job={a} onChange={onStatusChange} disabled={updatingStatusId === a.id} />
            </div>
          </div>
        ))
      )}
      </div>
    </div>
  );
}

export default function JobsView() {
  const [stats, setStats] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [apps, setApps] = useState([]);
  const [boardTab, setBoardTab] = useState('found');
  const [meta, setMeta] = useState({ cities: [] });
  const [filters, setFilters] = useState({ track: 'all', level: 'all', status: 'all', city: 'all', minScore: '' });
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [expandedCompanies, setExpandedCompanies] = useState(() => new Set());
  const [applyingId, setApplyingId] = useState(null);
  const [updatingStatusId, setUpdatingStatusId] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [run, setRun] = useState(null);
  const [runErr, setRunErr] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const pollRef = useRef(null);
  const running = run?.running === true;

  const params = useMemo(() => filterParams(filters, sort), [filters, sort]);

  useEffect(() => {
    api.jobMeta().then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setOpenId(null);
    Promise.all([
      api.jobs(params),
      api.jobStatsFiltered(params),
      api.jobApplications(),
    ])
      .then(([jobRes, statRes, appRes]) => {
        setJobs(jobRes.jobs || []);
        setStats(statRes);
        setApps(appRes.applications || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params, refreshKey]);

  useEffect(() => {
    setPage(1);
    setExpandedCompanies(new Set());
  }, [filters, sort]);

  useEffect(() => {
    function handleOutside(e) {
      if (!openId) return;
      if (e.target.closest('[data-job-panel]') || e.target.closest('[data-job-row]')) return;
      setOpenId(null);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [openId]);

  function updateFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

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
          setRefreshKey((k) => k + 1);
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
      setRunErr(e.message);
    }
  }

  function toggleCompany(company) {
    setExpandedCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(company)) next.delete(company);
      else next.add(company);
      return next;
    });
  }

  async function markApplied(id) {
    setApplyingId(id);
    try {
      const { job } = await api.markJobApplied(id);
      setJobs((list) => list.map((j) => (j.id === id ? job : j)));
      const [statRes, appRes] = await Promise.all([api.jobStatsFiltered(params), api.jobApplications()]);
      setStats(statRes);
      setApps(appRes.applications || []);
    } catch (e) {
      setRunErr(e.message);
    } finally {
      setApplyingId(null);
    }
  }

  async function setJobStatus(id, status) {
    setUpdatingStatusId(id);
    try {
      const { job } = await api.setJobStatus(id, status);
      setJobs((list) => list.map((j) => (j.id === id ? job : j)));
      const [statRes, appRes] = await Promise.all([api.jobStatsFiltered(params), api.jobApplications()]);
      setStats(statRes);
      setApps(appRes.applications || []);
    } catch (e) {
      setRunErr(e.message);
    } finally {
      setUpdatingStatusId(null);
    }
  }

  const displayRows = useMemo(() => groupRows(jobs, expandedCompanies, sort), [jobs, expandedCompanies, sort]);
  const grouped = sort === 'company';
  const pageCount = Math.max(1, Math.ceil(displayRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = displayRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Split the tracker: applied-and-pursuing vs. closed-out (incl. ghosted) vs. shortlisted.
  const activeApps = useMemo(() => apps.filter((a) => ACTIVE_APP_STATUSES.has(a.status) && !isGhosted(a)), [apps]);
  const inactiveApps = useMemo(
    () => apps.filter((a) => INACTIVE_STATUSES.has(a.status) || isGhosted(a)).map((a) => ({ ...a, _ghosted: isGhosted(a) })),
    [apps],
  );
  const shortlistCount = useMemo(() => apps.filter((a) => a.status === 'interested').length, [apps]);
  const shortlistOn = filters.status === 'interested';
  const newCount = useMemo(() => jobs.filter((j) => j.isNew).length, [jobs]);

  const statCards = useMemo(() => ([
    { value: stats?.totalSeen ?? '-', label: 'total jobs seen', color: 'var(--accent)' },
    { value: stats?.total ?? '-', label: `live jobs (${stats?.liveDays ?? 30}d)`, color: 'var(--job)' },
    { value: stats?.entry ?? '-', label: 'entry level fit', color: 'var(--success)' },
    { value: stats?.applied ?? '-', label: 'applied', color: 'var(--warn)' },
    { value: stats?.interviews ?? '-', label: 'interviews', color: 'var(--accent)' },
  ]), [stats]);

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

  return (
    <div className="view active">
      <div className="job-subtabs" role="tablist" aria-label="Job board sections">
        <button
          className={`job-subtab${boardTab === 'found' ? ' active' : ''}`}
          onClick={() => setBoardTab('found')}
          role="tab"
          aria-selected={boardTab === 'found'}
        >
          Found by agent
        </button>
        <button
          className={`job-subtab${boardTab === 'applications' ? ' active' : ''}`}
          onClick={() => setBoardTab('applications')}
          role="tab"
          aria-selected={boardTab === 'applications'}
        >
          Live applications{activeApps.length ? ` (${activeApps.length})` : ''}
        </button>
        <button
          className={`job-subtab${boardTab === 'inactive' ? ' active' : ''}`}
          onClick={() => setBoardTab('inactive')}
          role="tab"
          aria-selected={boardTab === 'inactive'}
        >
          Inactive applications{inactiveApps.length ? ` (${inactiveApps.length})` : ''}
        </button>
      </div>

      {boardTab === 'found' && (
        <>
          <div className="stat-grid">
            {statCards.map((c) => (
              <div className="stat-card" key={c.label}>
                <div className="stat-value" style={{ color: c.color }}>{c.value}</div>
                <div className="stat-label">{c.label}</div>
              </div>
            ))}
          </div>

      <div className="card">
        <div className="job-board-head">
          <div>
            <div className="card-title" style={{ marginBottom: 2 }}>
              {shortlistOn ? 'shortlist' : 'live listings'} {loading ? '· ...' : `· ${jobs.length} ${shortlistOn ? 'saved' : 'matched'}`}
              {!shortlistOn && newCount > 0 && <span className="badge" style={{ background: 'var(--success-dim, rgba(78,203,168,0.15))', color: 'var(--success)', marginLeft: 8 }}>{newCount} new this scan</span>}
            </div>
            <div className="text-xs text-dim">page {currentPage} of {pageCount}{grouped ? ` · ${displayRows.length} rows (grouped by company)` : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn${shortlistOn ? ' btn-primary' : ''}`}
              onClick={() => updateFilter('status', shortlistOn ? 'all' : 'interested')}
              title="Roles you marked Interested — your shortlist to revisit"
            >
              {shortlistOn ? '× clear shortlist' : `★ Shortlist${shortlistCount ? ` (${shortlistCount})` : ''}`}
            </button>
            <button className="btn btn-primary" onClick={handleRun} disabled={running}>
              {running ? `running · ${run?.pct ?? 0}%` : 'run now'}
            </button>
          </div>
        </div>

        {running && (
          <div className="job-progress" title={run?.step || ''}>
            <div className="job-progress-track"><div className="job-progress-fill" style={{ width: `${run?.pct ?? 0}%` }} /></div>
            <span className="job-progress-label">{run?.phase || 'starting'} · {run?.pct ?? 0}%</span>
          </div>
        )}

        <div className="job-filter-bar">
          <label>track
            <select value={filters.track} onChange={(e) => updateFilter('track', e.target.value)}>
              <option value="all">all</option>
              <option value="swe">SWE</option>
              <option value="da">DA</option>
            </select>
          </label>
          <label>level
            <select value={filters.level} onChange={(e) => updateFilter('level', e.target.value)}>
              <option value="all">all</option>
              <option value="entry">entry</option>
              <option value="mid">mid</option>
              <option value="senior">senior</option>
            </select>
          </label>
          <label>status
            <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)}>
              <option value="all">all</option>
              <option value="not_applied">not applied</option>
              <option value="interested">interested</option>
              <option value="applied">applied</option>
              <option value="interviewing">interviewing</option>
              <option value="offer">offer</option>
              <option value="rejected">rejected</option>
              <option value="withdrawn">withdrawn</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <label>city
            <select value={filters.city} onChange={(e) => updateFilter('city', e.target.value)}>
              <option value="all">all cities</option>
              {(meta.cities || []).map((city) => <option key={city} value={city}>{city}</option>)}
            </select>
          </label>
          <label>sort
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="newest">newest</option>
              <option value="match">match score</option>
              <option value="company">company</option>
            </select>
          </label>
          <div className="score-presets">
            {SCORE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                className={`score-preset${filters.minScore === preset.value ? ' active' : ''}`}
                onClick={() => updateFilter('minScore', preset.value)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {runErr && <div className="text-xs" style={{ color: 'var(--danger)', marginBottom: 10 }}>{runErr}</div>}
        {!runErr && !running && run?.summary && (
          <div className="text-xs" style={{ color: 'var(--text-secondary)', marginBottom: 10 }}>
            last run · {run.summary.written} written · {run.summary.matches} matches · {run.summary.entryFit} entry fit · {run.summary.elapsedSec}s
          </div>
        )}

        <table className="job-table interactive">
          <thead>
            <tr>
              <th>company</th><th>role</th><th>location</th><th>posted</th><th>match</th><th>level</th><th>status</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              if (row.type === 'company') {
                const open = expandedCompanies.has(row.company);
                return (
                  <tr className="company-group-row" key={`company-${row.company}`} onClick={() => toggleCompany(row.company)}>
                    <td colSpan="7">
                      <span className="company-caret">{open ? '-' : '+'}</span>
                      <strong>{row.company}</strong>
                      <span>{row.count} listings</span>
                      <span>top match {row.highest}%</span>
                    </td>
                  </tr>
                );
              }

              const j = row.job;
              const pct = Math.round(j.matchScore ?? 0);
              const color = matchColor(pct);
              return (
                <Fragment key={j.id}>
                  <tr
                    className={`job-click-row${openId === j.id ? ' open' : ''}${row.grouped ? ' grouped' : ''}`}
                    data-job-row
                    onClick={() => setOpenId((id) => (id === j.id ? null : j.id))}
                  >
                    <td>
                      <div className="job-company">
                        <button
                          className={`job-heart${j.status === 'interested' ? ' on' : ''}`}
                          disabled={updatingStatusId === j.id}
                          title={j.status === 'interested' ? 'Remove from shortlist' : 'Add to shortlist'}
                          aria-label={j.status === 'interested' ? 'Remove from shortlist' : 'Add to shortlist'}
                          onClick={(e) => { e.stopPropagation(); setJobStatus(j.id, j.status === 'interested' ? 'new' : 'interested'); }}
                        >
                          {j.status === 'interested' ? '♥︎' : '♡︎'}
                        </button>
                        {j.company}
                      </div>
                    </td>
                    <td className="job-title-cell">
                      {j.isNew && <span className="badge" style={{ background: 'var(--success-dim, rgba(78,203,168,0.15))', color: 'var(--success)', marginRight: 6 }}>new</span>}
                      {j.title}
                    </td>
                    <td className="text-mono text-xs">{j.location || '-'}</td>
                    <td className="text-mono text-xs">{formatDate(j.postedAt || j.addedAt)}</td>
                    <td>
                      <div className="match-cell">
                        <span className="match-pct" style={{ color }}>{pct}%</span>
                        <div className="match-mini"><div className="match-mini-fill" style={{ width: `${pct}%`, background: color }} /></div>
                      </div>
                    </td>
                    <td><LevelTag job={j} /></td>
                    <td><StatusBadge job={j} /></td>
                  </tr>
                  {openId === j.id && (
                    <JobDetail
                      job={j}
                      applying={applyingId === j.id}
                      updatingStatus={updatingStatusId === j.id}
                      onClose={() => setOpenId(null)}
                      onApplied={markApplied}
                      onStatusChange={setJobStatus}
                    />
                  )}
                </Fragment>
              );
            })}
            {!loading && visibleRows.length === 0 && (
              <tr><td colSpan="7" className="text-sm text-secondary">No jobs match these filters.</td></tr>
            )}
          </tbody>
        </table>

        <div className="pagination-row">
          <button className="btn" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>previous</button>
          <span className="text-xs text-mono text-dim">{((currentPage - 1) * PAGE_SIZE) + 1}-{Math.min(currentPage * PAGE_SIZE, displayRows.length)} of {displayRows.length}</span>
          <button className="btn" disabled={currentPage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>next</button>
        </div>
      </div>
        </>
      )}

      {boardTab === 'applications' && (
        <ApplicationTracker
          title="application tracker"
          subtitle={`${activeApps.length} live application${activeApps.length === 1 ? '' : 's'} from manual clicks and email confirmations`}
          list={activeApps}
          emptyText="No active applications yet. Manual applied clicks and email-agent confirmations will populate this timeline."
          onStatusChange={setJobStatus}
          updatingStatusId={updatingStatusId}
        />
      )}

      {boardTab === 'inactive' && (
        <ApplicationTracker
          title="inactive applications"
          subtitle={`${inactiveApps.length} closed-out application${inactiveApps.length === 1 ? '' : 's'} — withdrawn, rejected, or archived`}
          list={inactiveApps}
          emptyText="No inactive applications. When you withdraw, reject, or archive an application it moves here automatically."
          onStatusChange={setJobStatus}
          updatingStatusId={updatingStatusId}
          inactive
        />
      )}
    </div>
  );
}
