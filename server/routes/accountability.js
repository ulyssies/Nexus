// Accountability API — goals CRUD, daily check-ins, streaks, and the
// AI nudge. Goals + check-ins are pure local CRUD (no key needed); only
// the nudge calls Claude, and it degrades to a templated message.
import { Router } from 'express';
import {
  listGoals, getGoal, createGoal, updateGoal, deleteGoal,
  recordCheckin, listCheckins, today,
} from '../db/goalsRepo.js';
import { nudge, runAccountability } from '../agents/accountabilityAgent.js';

const router = Router();

// ── goals ─────────────────────────────────────────────────────────────────
// GET /api/accountability/goals?status=active
router.get('/goals', (req, res) => {
  const status = req.query.status === 'all' ? null : (req.query.status || 'active');
  res.json({ goals: listGoals({ status }) });
});

// POST /api/accountability/goals { title, cadence?, target?, ... }
router.post('/goals', (req, res) => {
  try {
    res.status(201).json({ goal: createGoal(req.body || {}) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/accountability/goals/:id — goal + streak + recent check-ins
router.get('/goals/:id', (req, res) => {
  const goal = getGoal(Number(req.params.id));
  if (!goal) return res.status(404).json({ error: 'goal not found' });
  res.json({ goal: { ...goal, checkins: listCheckins(goal.id) } });
});

// PUT /api/accountability/goals/:id — patch fields (status, target, ...)
router.put('/goals/:id', (req, res) => {
  if (!getGoal(Number(req.params.id))) return res.status(404).json({ error: 'goal not found' });
  try {
    res.json({ goal: updateGoal(Number(req.params.id), req.body || {}) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/accountability/goals/:id
router.delete('/goals/:id', (req, res) => {
  if (!deleteGoal(Number(req.params.id))) return res.status(404).json({ error: 'goal not found' });
  res.json({ deleted: true });
});

// ── check-ins ───────────────────────────────────────────────────────────────
// POST /api/accountability/goals/:id/checkin { status?, note?, checkin_date? }
// Returns the check-in plus the freshly recomputed streak.
router.post('/goals/:id/checkin', (req, res) => {
  const goal_id = Number(req.params.id);
  if (!getGoal(goal_id)) return res.status(404).json({ error: 'goal not found' });
  try {
    const body = req.body || {};
    const result = recordCheckin({
      goal_id,
      status: body.status || 'done',
      note: body.note || null,
      checkin_date: body.checkin_date || today(),
      source_agent: 'user',
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── the agent ────────────────────────────────────────────────────────────────
// GET /api/accountability/nudge — today's check-in message + pending goals.
router.get('/nudge', async (_req, res) => {
  try {
    res.json(await nudge());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/accountability/run — manual trigger of the nightly pass
// (refresh streaks + build the nudge), mirroring the job agent's "run now".
router.post('/run', async (_req, res) => {
  try {
    res.json(await runAccountability({ trigger: 'manual' }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
