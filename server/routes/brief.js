// Morning brief API — read today's digest (or a past day) + manual rebuild.
import { Router } from 'express';
import { getBrief, runMorningBrief } from '../agents/morningBriefAgent.js';
import { learnInterests } from '../db/briefRepo.js';

const router = Router();

// GET /api/brief — today's brief (or the most recent if today's isn't built).
// ?date=YYYY-MM-DD to fetch a specific day.
router.get('/', (req, res) => {
  res.json({ brief: getBrief(req.query.date || null), interests: learnInterests() });
});

// POST /api/brief/run — build today's brief now (the "refresh" button).
router.post('/run', async (_req, res) => {
  try {
    res.json({ brief: await runMorningBrief({ trigger: 'manual' }) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
