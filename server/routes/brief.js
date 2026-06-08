// Morning brief API — read today's digest (or a past day) + manual rebuild,
// plus user-steered interest tags (Settings → direct the news agent).
import { Router } from 'express';
import { getBrief, runMorningBrief, buildDigest } from '../agents/morningBriefAgent.js';
import { effectiveInterests, listInterests, addInterest, toggleInterest, deleteInterest } from '../db/briefRepo.js';

const router = Router();

// GET /api/brief — today's brief (or ?date=YYYY-MM-DD) + the interests actually
// driving it (user picks merged with auto-learned).
router.get('/', (req, res) => {
  res.json({ brief: getBrief(req.query.date || null), interests: effectiveInterests() });
});

// POST /api/brief/run — build today's brief now (the "refresh" button).
router.post('/run', async (_req, res) => {
  try {
    res.json({ brief: await runMorningBrief({ trigger: 'manual' }) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/brief/digest — synthesize (or return cached) the home digest
// paragraph. Cheap when fresh: only re-calls Claude when stale (>6h) or ?force=1.
router.post('/digest', async (req, res) => {
  try {
    res.json(await buildDigest({ force: req.query.force === '1' || (req.body || {}).force === true }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── user-steered interest tags ───────────────────────────────────────────────
// GET /api/brief/interests — all interest tags (active + inactive) for Settings.
router.get('/interests', (_req, res) => res.json({ interests: listInterests() }));

// POST /api/brief/interests { label } — add (or re-activate) an interest tag.
router.post('/interests', (req, res) => {
  try {
    res.status(201).json({ interest: addInterest((req.body || {}).label) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/brief/interests/:id/toggle — flip a tag active/inactive.
router.put('/interests/:id/toggle', (req, res) => {
  const interest = toggleInterest(Number(req.params.id));
  if (!interest) return res.status(404).json({ error: 'interest not found' });
  res.json({ interest });
});

// DELETE /api/brief/interests/:id — remove a tag.
router.delete('/interests/:id', (req, res) => {
  if (!deleteInterest(Number(req.params.id))) return res.status(404).json({ error: 'interest not found' });
  res.json({ deleted: true });
});

export default router;
