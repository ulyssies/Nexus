// Council of 5 API. POST a question → runs the full 2-pass + consensus
// pipeline (a handful of Claude calls, ~10–20s) and returns the session.
import { Router } from 'express';
import { askCouncil, getSession, listSessions, ELDERS } from '../agents/councilAgent.js';

const router = Router();

// GET /api/council/elders — persona names/roles/colors for the UI.
router.get('/elders', (_req, res) =>
  res.json({ elders: ELDERS.map(({ name, role, color }) => ({ name, role, color })) }));

// GET /api/council — recent sessions (history).
router.get('/', (_req, res) => res.json({ sessions: listSessions() }));

// POST /api/council/ask { question } — run the council (synchronous; minutes-safe).
router.post('/ask', async (req, res) => {
  const question = (req.body || {}).question;
  if (!question || !String(question).trim()) return res.status(400).json({ error: 'question is required' });
  try {
    const session = await askCouncil(question);
    res.status(201).json({ session });
  } catch (e) {
    if (e.code === 'NO_API_KEY') {
      return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set in server/.env — add it to ask the council.' });
    }
    res.status(500).json({ error: e.message });
  }
});

// GET /api/council/:id — replay a session.
router.get('/:id', (req, res) => {
  const session = getSession(Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'session not found' });
  res.json({ session });
});

export default router;
