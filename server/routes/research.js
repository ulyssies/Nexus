// Research agent API — sessions + chat + sources + distill-to-node, plus the
// trackable open questions. Chat/save need an Anthropic key (clear 400 without).
import { Router } from 'express';
import { createSession, getSession, listSessions } from '../db/researchRepo.js';
import { listOpenQuestions, resolveQuestion } from '../db/researchRepo.js';
import { chat, addSource, saveSession } from '../agents/researchAgent.js';

const router = Router();
const noKey = (res) => res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set in server/.env — research needs it.' });

// ── sessions ─────────────────────────────────────────────────────────────────
// GET /api/research/sessions — recent sessions (active + saved).
router.get('/sessions', (_req, res) => res.json({ sessions: listSessions() }));

// POST /api/research/sessions { topic? } — start a session.
router.post('/sessions', (req, res) => {
  res.status(201).json({ session: createSession({ topic: (req.body || {}).topic || null }) });
});

// GET /api/research/sessions/:id — a session with its full conversation.
router.get('/sessions/:id', (req, res) => {
  const session = getSession(Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'session not found' });
  res.json({ session });
});

// POST /api/research/sessions/:id/message { message } — one chat turn.
router.post('/sessions/:id/message', async (req, res) => {
  try {
    const reply = await chat(Number(req.params.id), (req.body || {}).message || '');
    res.status(201).json({ message: reply });
  } catch (e) {
    if (e.code === 'NO_API_KEY') return noKey(res);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/research/sessions/:id/source { text? , url? } — add a source.
router.post('/sessions/:id/source', async (req, res) => {
  try {
    const body = req.body || {};
    const message = await addSource(Number(req.params.id), { text: body.text || null, url: body.url || null });
    res.status(201).json({ message });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/research/sessions/:id/save { parent_id? } — distill into a node.
router.post('/sessions/:id/save', async (req, res) => {
  try {
    const node = await saveSession(Number(req.params.id), { parent_id: (req.body || {}).parent_id || null });
    res.status(201).json({ node });
  } catch (e) {
    if (e.code === 'NO_API_KEY') return noKey(res);
    res.status(400).json({ error: e.message });
  }
});

// ── open questions (trackable over time) ─────────────────────────────────────
// GET /api/research/open-questions?resolved=0
router.get('/open-questions', (req, res) => {
  res.json({ questions: listOpenQuestions({ resolved: req.query.resolved === '1' ? 1 : 0 }) });
});

// PUT /api/research/open-questions/:id/resolve { resolved? }
router.put('/open-questions/:id/resolve', (req, res) => {
  const ok = resolveQuestion(Number(req.params.id), (req.body || {}).resolved !== false);
  if (!ok) return res.status(404).json({ error: 'question not found' });
  res.json({ resolved: true });
});

export default router;
