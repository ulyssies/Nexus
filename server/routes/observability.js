// Observability API — one snapshot for the Settings panel: per-agent last/next
// run + status, recent errors, and cost rollups (today / total / daily / per-agent).
import { Router } from 'express';
import { getObservability } from '../db/observabilityRepo.js';

const router = Router();

// GET /api/observability — everything the Settings observability panel needs.
router.get('/', (_req, res) => {
  try {
    res.json(getObservability());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
