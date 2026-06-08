// Job board read API. Read-only for now (no scoring/fetching yet) —
// this just proves data flows SQLite -> UI.
import { Router } from 'express';
import db from '../db/index.js';
import { runJobAgent, getRunState } from '../agents/jobAgent.js';
import { purgeStaleJobs } from '../db/maintenance.js';

const router = Router();
const VALID_STATUS = new Set(['new', 'interested', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn', 'archived']);
const LIVE_DAYS = 30;

const LEVEL_SQL = `
  CASE
    WHEN entry_level_fit = 1
      OR lower(title) LIKE '%entry%'
      OR lower(title) LIKE '%junior%'
      OR lower(title) LIKE '%intern%'
      OR lower(title) LIKE '%new grad%'
    THEN 'entry'
    WHEN lower(title) LIKE '%senior%'
      OR lower(title) LIKE 'sr %'
      OR lower(title) LIKE '% sr %'
      OR lower(title) LIKE '%staff%'
      OR lower(title) LIKE '%principal%'
      OR lower(title) LIKE '%lead%'
    THEN 'senior'
    ELSE 'mid'
  END
`;

const LIVE_JOB_SQL = `
  (
    status <> 'new'
    OR applied_at IS NOT NULL
    OR status_updated_at IS NOT NULL
    OR julianday('now') - julianday(COALESCE(posted_at, created_at)) <= @liveDays
  )
`;

function normalizeTrack(track) {
  const t = String(track || '').toLowerCase();
  return ['swe', 'da'].includes(t) ? t : null;
}

function normalizeStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'not_applied') return 'new';
  return VALID_STATUS.has(s) ? s : null;
}

function buildJobFilter(query = {}) {
  const where = [LIVE_JOB_SQL];
  const params = { liveDays: LIVE_DAYS };

  const track = normalizeTrack(query.track);
  if (track) { where.push('track = @track'); params.track = track; }

  const level = String(query.level || '').toLowerCase();
  if (['entry', 'mid', 'senior'].includes(level)) {
    where.push(`(${LEVEL_SQL}) = @level`);
    params.level = level;
  }

  const status = normalizeStatus(query.status);
  if (status) { where.push('status = @status'); params.status = status; }

  if (query.city) {
    where.push("(COALESCE(NULLIF(target_city, ''), location, '') = @city OR location = @city)");
    params.city = String(query.city);
  }

  const minScore = Number(query.minScore);
  if (Number.isFinite(minScore) && minScore > 0) {
    where.push('COALESCE(match_score, 0) >= @minScore');
    params.minScore = minScore;
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// Map a stored job row into the shape the Job board view renders.
function toCard(row) {
  let reasons = {};
  try { reasons = JSON.parse(row.match_reasons || '{}'); } catch { /* keep {} */ }
  const inferredLevel = row.inferred_level || (row.entry_level_fit ? 'entry' : 'mid');
  return {
    id: row.id,
    company: row.company,
    title: row.title,
    location: row.location,
    targetCity: row.target_city,
    track: row.track,
    source: row.source,
    url: row.url,
    description: row.description,
    salary: row.salary,
    postedAt: row.posted_at,
    addedAt: row.created_at,
    appliedAt: row.applied_at,
    statusUpdatedAt: row.status_updated_at,
    matchScore: row.match_score,
    matchCategory: row.match_category,
    level: inferredLevel[0].toUpperCase() + inferredLevel.slice(1),
    levelKey: inferredLevel,
    entryLevelFit: !!row.entry_level_fit,
    status: row.status,
    statusUpdatedBy: row.status_updated_by,
    reason: reasons.reason || null,
    roleSummary: reasons.roleSummary || reasons.roleDescription || null,
    responsibilities: reasons.responsibilities || [],
    missingSkills: reasons.missingSkills || [],
    alignedStrengths: reasons.alignedStrengths || reasons.alignedSkills || reasons.matchedSkills || reasons.skillsAligned || [],
    positives: reasons.positives || [],
    negatives: reasons.negatives || reasons.risks || [],
  };
}

function orderBy(sort) {
  switch (String(sort || 'newest').toLowerCase()) {
    case 'match':
      return 'ORDER BY match_score DESC NULLS LAST, date(COALESCE(posted_at, created_at)) DESC, company COLLATE NOCASE ASC';
    case 'company':
      return 'ORDER BY company COLLATE NOCASE ASC, date(COALESCE(posted_at, created_at)) DESC, match_score DESC NULLS LAST';
    case 'newest':
    default:
      return 'ORDER BY (COALESCE(posted_at, created_at) IS NULL) ASC, datetime(COALESCE(posted_at, created_at)) DESC, match_score DESC NULLS LAST';
  }
}

// GET /api/jobs?track=swe&level=entry&status=applied&city=Atlanta&minScore=80&sort=newest
router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 5000, 5000);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const { clause, params } = buildJobFilter(req.query);
  // The Found board is agent-discovered listings only. Applications created from
  // email (source='email') are tracker-only stubs — keep them off this board.
  const boardClause = `${clause} AND COALESCE(source, '') <> 'email'`;

  const rows = db.prepare(`
    SELECT *, ${LEVEL_SQL} AS inferred_level
      FROM jobs ${boardClause}
      ${orderBy(req.query.sort)}
      LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  const total = db.prepare(`SELECT COUNT(*) n FROM jobs ${boardClause}`).get(params).n;

  // "New since last scan": rows created in the most recent completed job run.
  const lastScanAt = db.prepare(
    "SELECT MAX(started_at) v FROM agent_runs WHERE agent = 'job' AND status = 'ok'"
  ).get()?.v || null;
  const jobs = rows.map((r) => ({ ...toCard(r), isNew: !!(lastScanAt && r.created_at >= lastScanAt) }));

  res.json({ jobs, count: rows.length, total, limit, offset, lastScanAt });
});

// GET /api/jobs/stats — the four stat cards on the Job board.
router.get('/stats', (req, res) => {
  const { clause, params } = buildJobFilter(req.query);
  const total = db.prepare(`SELECT COUNT(*) n FROM jobs ${clause}`).get(params).n;
  const entry = db.prepare(`SELECT COUNT(*) n FROM jobs ${clause ? `${clause} AND` : 'WHERE'} (${LEVEL_SQL}) = 'entry'`).get(params).n;
  const applied = db.prepare(`SELECT COUNT(*) n FROM jobs ${clause ? `${clause} AND` : 'WHERE'} status = 'applied'`).get(params).n;
  const interviews = db.prepare(`SELECT COUNT(*) n FROM jobs ${clause ? `${clause} AND` : 'WHERE'} status = 'interviewing'`).get(params).n;
  const totalSeen = db.prepare('SELECT COUNT(*) n FROM job_seen_keys').get().n;
  res.json({ totalSeen, liveDays: LIVE_DAYS, total, entry, applied, interviews });
});

// GET /api/jobs/meta — filter dropdown values.
router.get('/meta', (_req, res) => {
  const cities = db.prepare(`
    SELECT DISTINCT COALESCE(NULLIF(target_city, ''), location) city
      FROM jobs
     WHERE ${LIVE_JOB_SQL}
       AND COALESCE(NULLIF(target_city, ''), location) IS NOT NULL
     ORDER BY city COLLATE NOCASE ASC
  `).all({ liveDays: LIVE_DAYS }).map((r) => r.city).filter(Boolean);
  res.json({ cities });
});

// GET /api/jobs/applications — rows for the application tracker timeline.
// Anything the user/email agent has moved off 'new'.
router.get('/applications', (_req, res) => {
  const rows = db.prepare(`
    SELECT *, ${LEVEL_SQL} AS inferred_level FROM jobs
    WHERE status NOT IN ('new')
    ORDER BY status_updated_at DESC NULLS LAST, match_score DESC
  `).all();
  res.json({ applications: rows.map(toCard) });
});

// POST /api/jobs/:id/applied — manual fallback for applications made outside Gmail.
router.post('/:id/applied', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id' });

  const info = db.prepare(`
    UPDATE jobs
       SET status = 'applied',
           applied_at = COALESCE(applied_at, datetime('now')),
           status_updated_at = datetime('now'),
           status_updated_by = 'user',
           updated_at = datetime('now')
     WHERE id = @id
  `).run({ id });

  if (!info.changes) return res.status(404).json({ error: 'Job not found' });

  const row = db.prepare(`SELECT *, ${LEVEL_SQL} AS inferred_level FROM jobs WHERE id = ?`).get(id);
  res.json({ job: toCard(row) });
});

// POST /api/jobs/:id/status — manual correction when the email agent misses a queue/status change.
router.post('/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const status = normalizeStatus(req.body?.status);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id' });
  if (!status) return res.status(400).json({ error: 'Invalid job status' });

  const applicationStatus = ['applied', 'interviewing', 'offer', 'rejected', 'withdrawn', 'archived'].includes(status);
  const info = db.prepare(`
    UPDATE jobs
       SET status = @status,
           applied_at = CASE
             WHEN @status = 'new' THEN NULL
             WHEN @applicationStatus = 1 THEN COALESCE(applied_at, datetime('now'))
             ELSE applied_at
           END,
           status_updated_at = CASE WHEN @status = 'new' THEN NULL ELSE datetime('now') END,
           status_updated_by = CASE WHEN @status = 'new' THEN NULL ELSE 'user' END,
           updated_at = datetime('now')
     WHERE id = @id
  `).run({ id, status, applicationStatus: applicationStatus ? 1 : 0 });

  if (!info.changes) return res.status(404).json({ error: 'Job not found' });

  const row = db.prepare(`SELECT *, ${LEVEL_SQL} AS inferred_level FROM jobs WHERE id = ?`).get(id);
  res.json({ job: toCard(row) });
});

// POST /api/jobs/run — kick off the pipeline on demand (the "run now" button).
// Returns 202 immediately; the run continues in the background and the client
// polls /run/status. A run takes minutes, so we never hold the request open.
router.post('/run', (req, res) => {
  if (getRunState().running) {
    return res.status(409).json({ error: 'Job agent is already running', state: getRunState() });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({
      error: 'ANTHROPIC_API_KEY is not set in server/.env — add your keys to run the agent.',
      state: getRunState(),
    });
  }
  // Fire and forget — run state captures success/failure; errors are logged in the agent.
  runJobAgent({ trigger: 'manual' })
    .then(() => purgeStaleJobs({ days: 30 }))
    .catch(() => {});
  res.status(202).json({ started: true, state: getRunState() });
});

// GET /api/jobs/run/status — current run state for the UI to poll.
router.get('/run/status', (_req, res) => res.json(getRunState()));

export default router;
