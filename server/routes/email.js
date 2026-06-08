// Email agent API — read the triaged flags + Gmail auth status + manual run.
// All reads are local; POST /run hits Gmail (read-only) + Claude.
import { Router } from 'express';
import { listFlags, listFlagsPaged, flagCounts, flagStats, emailInsights } from '../db/emailRepo.js';
import { runEmailAgent, gmailStatus } from '../agents/emailAgent.js';

const router = Router();

// GET /api/email/status — is Gmail authorized? (drives the UI's setup prompt)
router.get('/status', (_req, res) => res.json(gmailStatus()));

// GET /api/email/stats — the four stat cards (total/urgent/unread/deadlines).
router.get('/stats', (_req, res) => res.json(flagStats()));

// GET /api/email/counts — per-tab counts for the inbox filter bar.
router.get('/counts', (_req, res) => res.json({ counts: flagCounts() }));

// GET /api/email/insights — plain-language agent rail (derived, read-only).
router.get('/insights', (_req, res) => res.json({ insights: emailInsights() }));

// GET /api/email/flags — paginated, filtered inbox.
//   ?filter=all|urgent|important|job-alert|newsletter|noise &page=1 &pageSize=25
//   (legacy ?importance= still works for the old un-paged callers).
router.get('/flags', (req, res) => {
  if (req.query.importance && !req.query.filter) {
    return res.json({ flags: listFlags({ importance: req.query.importance, limit: Math.min(Number(req.query.limit) || 100, 500) }) });
  }
  res.json(listFlagsPaged({
    filter: req.query.filter || 'all',
    page: Number(req.query.page) || 1,
    pageSize: Math.min(Number(req.query.pageSize) || 25, 100),
  }));
});

// POST /api/email/run — scan + classify now. Returns the run summary, or a
// clear { skipped, reason } when Gmail isn't set up yet (never a 500 for that).
router.post('/run', async (_req, res) => {
  try {
    const result = await runEmailAgent({ trigger: 'manual' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
