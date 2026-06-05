// Email agent API — read the triaged flags + Gmail auth status + manual run.
// All reads are local; POST /run hits Gmail (read-only) + Claude.
import { Router } from 'express';
import { listFlags, flagStats } from '../db/emailRepo.js';
import { runEmailAgent, gmailStatus } from '../agents/emailAgent.js';

const router = Router();

// GET /api/email/status — is Gmail authorized? (drives the UI's setup prompt)
router.get('/status', (_req, res) => res.json(gmailStatus()));

// GET /api/email/stats — the four stat cards (total/urgent/unread/deadlines).
router.get('/stats', (_req, res) => res.json(flagStats()));

// GET /api/email/flags?importance=urgent — triaged inbox, newest first.
router.get('/flags', (req, res) => {
  const importance = req.query.importance || null;
  res.json({ flags: listFlags({ importance, limit: Math.min(Number(req.query.limit) || 100, 500) }) });
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
