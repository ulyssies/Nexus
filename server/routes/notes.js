// Notes / second-brain API. CRUD over notes + tags, plus the graph feed.
// Read/write only — AI auto-tagging is layered on in routes that call the
// tag agent (see POST /). No external keys needed for the CRUD paths.
import { Router } from 'express';
import { listNotes, getNote, createNote, deleteNote, setNoteTags, getGraph, getAllTagNames, createConcept, setParent, listParents } from '../db/notesRepo.js';
import { tagNote } from '../agents/tagAgent.js';

const router = Router();

// Run the tag agent for a note and persist the result. No-op (returns the
// note unchanged) when no API key is set — the agent degrades gracefully.
async function autoTag(note) {
  const { tags } = await tagNote(note, getAllTagNames());
  if (tags.length) setNoteTags(note.id, tags);
  return getNote(note.id);
}

// GET /api/notes?kind=journal&limit=100
router.get('/', (req, res) => {
  const { kind } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
  res.json({ notes: listNotes({ kind: kind || null, limit }) });
});

// GET /api/notes/graph — nodes (notes) + links (tag edges + directed parent edges).
// Declared before /:id so "graph" isn't captured as an id.
router.get('/graph', (_req, res) => res.json(getGraph()));

// GET /api/notes/parents — nodes usable as a hierarchy parent (concepts first).
router.get('/parents', (_req, res) => res.json({ parents: listParents() }));

// POST /api/notes/concepts { title, description?, parent_id? } — create a concept
// node (a pure organizational anchor with no journal content).
router.post('/concepts', (req, res) => {
  try {
    res.status(201).json({ note: createConcept(req.body || {}) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/notes/:id/parent { parent_id } — file a note under a parent (or null).
router.put('/:id/parent', (req, res) => {
  const id = Number(req.params.id);
  if (!getNote(id)) return res.status(404).json({ error: 'note not found' });
  try {
    res.json({ note: setParent(id, (req.body || {}).parent_id ?? null) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/notes { body, title?, kind? } — create a note, then auto-tag it.
// We await tagging so the response already carries tags (the journal's
// "Save + auto-tag" expects them); if no key is set, tags come back empty.
router.post('/', async (req, res) => {
  try {
    const created = createNote(req.body || {});
    const note = await autoTag(created);
    res.status(201).json({ note });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/notes/:id/retag — re-run the tag agent on an existing note.
router.post('/:id/retag', async (req, res) => {
  const note = getNote(Number(req.params.id));
  if (!note) return res.status(404).json({ error: 'note not found' });
  res.json({ note: await autoTag(note) });
});

// GET /api/notes/:id
router.get('/:id', (req, res) => {
  const note = getNote(Number(req.params.id));
  if (!note) return res.status(404).json({ error: 'note not found' });
  res.json({ note });
});

// PUT /api/notes/:id/tags { tags: ["career", "projects"] } — manual tag edit.
router.put('/:id/tags', (req, res) => {
  const id = Number(req.params.id);
  if (!getNote(id)) return res.status(404).json({ error: 'note not found' });
  const tags = setNoteTags(id, Array.isArray(req.body?.tags) ? req.body.tags : []);
  res.json({ tags });
});

// DELETE /api/notes/:id
router.delete('/:id', (req, res) => {
  const ok = deleteNote(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'note not found' });
  res.json({ deleted: true });
});

export default router;
