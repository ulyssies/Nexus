// Home dashboard API — one cross-agent snapshot (stats + agent status + feed).
import { Router } from 'express';
import { getOverview, getHome } from '../db/overviewRepo.js';

const router = Router();

// GET /api/overview — the legacy snapshot (stats + agent status + small feed).
router.get('/', (_req, res) => {
  try {
    res.json(getOverview());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/home — the daily command center: alerts, today's agenda, agent
// health (last/next run + insight), the cached brief digest, and the full feed.
export const homeRouter = Router();
homeRouter.get('/', (_req, res) => {
  try {
    res.json(getHome());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
