// Home dashboard API — one cross-agent snapshot (stats + agent status + feed).
import { Router } from 'express';
import { getOverview } from '../db/overviewRepo.js';

const router = Router();

// GET /api/overview — everything the home command-center needs in one call.
router.get('/', (_req, res) => {
  try {
    res.json(getOverview());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
