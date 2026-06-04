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
  INSERT INTO notes (kind, title, body, source_agent) VALUES (@kind, @title, @body, @source_agent)`);
const getNoteStmt = db.prepare('SELECT * FROM notes WHERE id = ?');
const deleteNoteStmt = db.prepare('DELETE FROM notes WHERE id = ?');

export function createNote({ title = null, body, kind = 'journal', source_agent = 'user' }) {
  if (!body || !String(body).trim()) throw new Error('Note body is required');
  const info = insertNote.run({ kind, title, body: String(body).trim(), source_agent });
  return getNote(info.lastInsertRowid);
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

// ── graph: nodes = notes, edges = notes sharing a tag ─────────────────────────
const NODE_COLOR = { journal: '#9d8cff', note: '#6ea8fe', project: '#7c6fe0', brief: '#f0a050' };
export function getGraph() {
  const notes = db.prepare('SELECT id, kind, title, body, created_at FROM notes ORDER BY created_at DESC').all();
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

  const nodes = notes.map((n) => {
    const tags = tagsByNote.get(n.id) || [];
    return {
      id: n.id,
      kind: n.kind,
      label: n.title || n.body.slice(0, 40),
      preview: n.body.slice(0, 160),
      tags: tags.map((t) => t.name),
      color: tags.length ? NODE_COLOR[n.kind] || '#6ea8fe' : '#5a5a66', // untagged = dim
      val: 1 + tags.length,
    };
  });

  // edge between any two notes sharing a tag (deduped; carries the tag color)
  const seen = new Set();
  const links = [];
  for (const [tagId, noteIds] of notesByTag) {
    const color = tagRows.find((r) => r.tag_id === tagId)?.color;
    for (let i = 0; i < noteIds.length; i++) {
      for (let j = i + 1; j < noteIds.length; j++) {
        const [a, b] = noteIds[i] < noteIds[j] ? [noteIds[i], noteIds[j]] : [noteIds[j], noteIds[i]];
        const key = `${a}-${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ source: a, target: b, color });
      }
    }
  }
  return { nodes, links };
}
