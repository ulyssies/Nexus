// Job board read API. Read-only for now (no scoring/fetching yet) —
// this just proves data flows SQLite -> UI.
import { Router } from 'express';
import db from '../db/index.js';
import { runJobAgent, getRunState } from '../agents/jobAgent.js';

const router = Router();

// Map a stored job row into the shape the Job board view renders.
function toCard(row) {
  let reasons = {};
  try { reasons = JSON.parse(row.match_reasons || '{}'); } catch { /* keep {} */ }
  return {
    id: row.id,
    company: row.company,
    title: row.title,
    location: row.location,
    targetCity: row.target_city,
    track: row.track,
    source: row.source,
    url: row.url,
    salary: row.salary,
    postedAt: row.posted_at,
    matchScore: row.match_score,
    matchCategory: row.match_category,
    level: row.entry_level_fit ? 'Entry' : 'Stretch',
    entryLevelFit: !!row.entry_level_fit,
    status: row.status,
    statusUpdatedBy: row.status_updated_by,
    reason: reasons.reason || null,
    missingSkills: reasons.missingSkills || [],
  };
}

// GET /api/jobs?track=swe&entry=1&status=applied&limit=100
// Defaults to the strongest matches first so the board opens on signal.
router.get('/', (req, res) => {
  const { track, entry, status } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);

  const where = [];
  const params = {};
  if (track) { where.push('track = @track'); params.track = track; }
  if (entry === '1') { where.push('entry_level_fit = 1'); }
  if (status) { where.push('status = @status'); params.status = status; }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT * FROM jobs ${clause}
    ORDER BY match_score DESC, company COLLATE NOCASE ASC
    LIMIT @limit
  `).all({ ...params, limit });

  res.json({ jobs: rows.map(toCard), count: rows.length });
});

// GET /api/jobs/stats — the four stat cards on the Job board.
router.get('/stats', (_req, res) => {
  const total = db.prepare('SELECT COUNT(*) n FROM jobs').get().n;
  const entry = db.prepare('SELECT COUNT(*) n FROM jobs WHERE entry_level_fit = 1').get().n;
  const applied = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status = 'applied'").get().n;
  const interviews = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status = 'interviewing'").get().n;
  res.json({ total, entry, applied, interviews });
});

// GET /api/jobs/applications — rows for the application tracker timeline.
// Anything the user/email agent has moved off 'new'.
router.get('/applications', (_req, res) => {
  const rows = db.prepare(`
    SELECT * FROM jobs
    WHERE status NOT IN ('new')
    ORDER BY status_updated_at DESC NULLS LAST, match_score DESC
  `).all();
  res.json({ applications: rows.map(toCard) });
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
  runJobAgent({ trigger: 'manual' }).catch(() => {});
  res.status(202).json({ started: true, state: getRunState() });
});

// GET /api/jobs/run/status — current run state for the UI to poll.
router.get('/run/status', (_req, res) => res.json(getRunState()));

export default router;
