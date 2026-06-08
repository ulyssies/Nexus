// ============================================================
//  Notes / second-brain write+read layer.
//
//  notes are the universal graph node (journal entries, free notes,
//  project/brief notes — distinguished by `kind`). Tags are AI-assigned
//  (see agents/tagAgent.js) and shared tags are what link two notes in
//  the graph. This module owns all notes/tags/note_tags access so the
//  journal view, graph view, and tag agent share one source of truth.
// ============================================================
import db from './index.js';

// Stable per-tag color from a small palette (matches the agent accents in
// the design) so the same tag is always drawn the same color in the graph.
const TAG_PALETTE = ['#4ecba8', '#6ea8fe', '#7c6fe0', '#f0a050', '#e05b5b', '#c9a227', '#e07bd0'];
function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

// ── tags ──────────────────────────────────────────────────────────────────
const insertTag = db.prepare('INSERT INTO tags (name, color) VALUES (@name, @color) ON CONFLICT(name) DO NOTHING');
const getTagByName = db.prepare('SELECT id, name, color FROM tags WHERE name = ? COLLATE NOCASE');

function getOrCreateTag(name) {
  const clean = String(name).trim().replace(/^#+/, '').trim();
  if (!clean) return null;
  insertTag.run({ name: clean, color: colorFor(clean.toLowerCase()) });
  return getTagByName.get(clean);
}

// All existing tag names — fed to the tag agent so it reuses tags when they
// fit, which is what keeps the graph connected instead of fragmenting.
export const getAllTagNames = () =>
  db.prepare('SELECT name FROM tags ORDER BY name COLLATE NOCASE').all().map((r) => r.name);

const tagsForNoteStmt = db.prepare(`
  SELECT t.id, t.name, t.color FROM tags t
  JOIN note_tags nt ON nt.tag_id = t.id
  WHERE nt.note_id = ? ORDER BY t.name COLLATE NOCASE`);
export const getNoteTags = (noteId) => tagsForNoteStmt.all(noteId);

const clearNoteTags = db.prepare('DELETE FROM note_tags WHERE note_id = ?');
const linkNoteTag = db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)');

/** Replace a note's tags with `names`. Returns the resulting tag rows. */
export const setNoteTags = db.transaction((noteId, names = []) => {
  clearNoteTags.run(noteId);
  for (const name of names) {
    const tag = getOrCreateTag(name);
    if (tag) linkNoteTag.run(noteId, tag.id);
  }
  return getNoteTags(noteId);
});

// ── notes ───────────────────────────────────────────────────────────────────
const insertNote = db.prepare(`
  INSERT INTO notes (kind, title, body, source_agent, node_type, parent_id, is_concept)
  VALUES (@kind, @title, @body, @source_agent, @node_type, @parent_id, @is_concept)`);

// node_type is the second-brain taxonomy; default it from the legacy `kind`.
const NODE_TYPE_FROM_KIND = { journal: 'journal', project: 'archivist', brief: 'brief', note: 'note' };
const getNoteStmt = db.prepare('SELECT * FROM notes WHERE id = ?');
const deleteNoteStmt = db.prepare('DELETE FROM notes WHERE id = ?');

export function createNote({ title = null, body, kind = 'journal', source_agent = 'user', node_type = null, parent_id = null, is_concept = 0 }) {
  if (!body || !String(body).trim()) throw new Error('Note body is required');
  const info = insertNote.run({
    kind, title, body: String(body).trim(), source_agent,
    node_type: node_type || NODE_TYPE_FROM_KIND[kind] || 'note',
    parent_id: parent_id || null,
    is_concept: is_concept ? 1 : 0,
  });
  return getNote(info.lastInsertRowid);
}

// ── hierarchy (Phase 9) — additive: directional parent→child structure on top
// of the flat shared-tag graph. Concept nodes are pure organizational anchors. ─
export function createConcept({ title, description = null, parent_id = null }) {
  if (!title || !String(title).trim()) throw new Error('Concept title is required');
  return createNote({
    title: String(title).trim(),
    body: description && String(description).trim() ? String(description).trim() : String(title).trim(),
    kind: 'note', node_type: 'concept', is_concept: 1, parent_id, source_agent: 'user',
  });
}

/** Re-parent a note (or detach with parentId=null). Guards against self/cycle. */
export function setParent(noteId, parentId) {
  if (parentId != null && Number(parentId) === Number(noteId)) throw new Error('a note cannot be its own parent');
  if (parentId != null && !getNoteStmt.get(parentId)) throw new Error('parent not found');
  db.prepare('UPDATE notes SET parent_id = ? WHERE id = ?').run(parentId || null, noteId);
  return getNote(noteId);
}

/** Nodes eligible to be a parent — concepts first, then everything else. */
export function listParents() {
  return db.prepare(`
    SELECT id, title, body, node_type, is_concept FROM notes
     ORDER BY is_concept DESC, (node_type = 'concept') DESC, created_at DESC`).all()
    .map((n) => ({ id: n.id, label: n.title || n.body.slice(0, 40), node_type: n.node_type, is_concept: !!n.is_concept }));
}

export function getNote(id) {
  const note = getNoteStmt.get(id);
  if (!note) return null;
  return { ...note, tags: getNoteTags(id) };
}

export function deleteNote(id) {
  return deleteNoteStmt.run(id).changes > 0; // note_tags cascade via FK
}

/** Recent notes (optionally by kind), each with its tags. */
export function listNotes({ kind = null, limit = 100 } = {}) {
  const rows = kind
    ? db.prepare('SELECT * FROM notes WHERE kind = ? ORDER BY created_at DESC LIMIT ?').all(kind, limit)
    : db.prepare('SELECT * FROM notes ORDER BY created_at DESC LIMIT ?').all(limit);
  if (!rows.length) return [];
  // one query for all tags across the page, grouped in JS
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const tagRows = db.prepare(`
    SELECT nt.note_id, t.id, t.name, t.color FROM note_tags nt
    JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id IN (${placeholders})`).all(...ids);
  const byNote = new Map();
  for (const tr of tagRows) {
    if (!byNote.has(tr.note_id)) byNote.set(tr.note_id, []);
    byNote.get(tr.note_id).push({ id: tr.id, name: tr.name, color: tr.color });
  }
  return rows.map((r) => ({ ...r, tags: byNote.get(r.id) || [] }));
}

// ── graph: nodes = notes; edges are TWO kinds ────────────────────────────────
//   • tag edges (associative, undirected) — two notes sharing a tag. The flat
//     Zettelkasten layer the tagging agent produces. Untouched by the hierarchy.
//   • parent edges (directional, parent → child) — the Phase 9 hierarchy layer.
//   The frontend renders the two differently (directed flag).
// Color is keyed by node_type so research/concept nodes are visually distinct.
const NODE_COLOR = { journal: '#9d8cff', note: '#6ea8fe', archivist: '#7c6fe0', brief: '#f0a050', research: '#4ecba8', concept: '#e0b050' };
export function getGraph() {
  const notes = db.prepare('SELECT id, kind, node_type, parent_id, is_concept, title, body, created_at FROM notes ORDER BY created_at DESC').all();
  const tagRows = db.prepare(`
    SELECT nt.note_id, t.id AS tag_id, t.name, t.color FROM note_tags nt
    JOIN tags t ON t.id = nt.tag_id`).all();

  const tagsByNote = new Map();
  const notesByTag = new Map();
  for (const r of tagRows) {
    if (!tagsByNote.has(r.note_id)) tagsByNote.set(r.note_id, []);
    tagsByNote.get(r.note_id).push({ id: r.tag_id, name: r.name, color: r.color });
    if (!notesByTag.has(r.tag_id)) notesByTag.set(r.tag_id, []);
    notesByTag.get(r.tag_id).push(r.note_id);
  }
  const ids = new Set(notes.map((n) => n.id));

  const nodes = notes.map((n) => {
    const tags = tagsByNote.get(n.id) || [];
    const type = n.node_type || n.kind;
    const concept = !!n.is_concept;
    return {
      id: n.id,
      kind: n.kind,
      nodeType: type,
      isConcept: concept,
      parentId: n.parent_id || null,
      label: n.title || n.body.slice(0, 40),
      preview: n.body.slice(0, 160),
      tags: tags.map((t) => t.name),
      // concepts/parents are anchor-colored even without tags; leaves dim when untagged
      color: concept ? '#e0b050' : (tags.length ? NODE_COLOR[type] || '#6ea8fe' : '#5a5a66'),
      val: (concept ? 3 : 1) + tags.length + (notes.filter((c) => c.parent_id === n.id).length),
    };
  });

  // tag edges (undirected, associative)
  const seen = new Set();
  const links = [];
  for (const [tagId, noteIds] of notesByTag) {
    const color = tagRows.find((r) => r.tag_id === tagId)?.color;
    for (let i = 0; i < noteIds.length; i++) {
      for (let j = i + 1; j < noteIds.length; j++) {
        const [a, b] = noteIds[i] < noteIds[j] ? [noteIds[i], noteIds[j]] : [noteIds[j], noteIds[i]];
        const key = `t:${a}-${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ source: a, target: b, color, kind: 'tag', directed: false });
      }
    }
  }
  // parent edges (directional, hierarchy) — distinct color, drawn with an arrow
  for (const n of notes) {
    if (n.parent_id && ids.has(n.parent_id)) {
      links.push({ source: n.parent_id, target: n.id, color: '#e0b050', kind: 'parent', directed: true });
    }
  }
  return { nodes, links };
}
