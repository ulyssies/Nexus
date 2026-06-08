// ============================================================
//  Research sessions — the chat layer + the distilled-node persistence.
//
//  A session holds an ephemeral conversation (research_messages, including
//  pasted/fetched sources). saveResearchNode() condenses it into ONE permanent
//  knowledge node: a notes row (node_type='research') with a structured body,
//  tagged by its key concepts (so it joins the second-brain graph), with its
//  open questions split into research_open_questions for tracking. The session
//  is then marked 'saved' and linked to the node.
// ============================================================
import db from './index.js';
import { createNote, setNoteTags, getNote } from './notesRepo.js';

// ── sessions + messages ─────────────────────────────────────────────────────
export function createSession({ topic = null } = {}) {
  const id = db.prepare('INSERT INTO research_sessions (topic) VALUES (?)').run(topic || null).lastInsertRowid;
  return getSession(id);
}

export function getSession(id) {
  const session = db.prepare('SELECT * FROM research_sessions WHERE id = ?').get(id);
  if (!session) return null;
  const messages = db.prepare(
    'SELECT id, role, content, meta, created_at FROM research_messages WHERE session_id = ? ORDER BY id'
  ).all(id);
  return { ...session, messages };
}

export function listSessions(limit = 30) {
  return db.prepare(`
    SELECT s.id, s.topic, s.status, s.note_id, s.created_at, s.updated_at,
           (SELECT COUNT(*) FROM research_messages m WHERE m.session_id = s.id) AS message_count
      FROM research_sessions s ORDER BY s.updated_at DESC LIMIT ?`).all(limit);
}

const insertMessage = db.prepare(
  'INSERT INTO research_messages (session_id, role, content, meta) VALUES (@session_id, @role, @content, @meta)');
const touch = db.prepare("UPDATE research_sessions SET updated_at = datetime('now') WHERE id = ?");

export function addMessage(sessionId, { role, content, meta = null }) {
  if (!db.prepare('SELECT 1 FROM research_sessions WHERE id = ?').get(sessionId)) throw new Error(`session ${sessionId} not found`);
  const id = insertMessage.run({ session_id: sessionId, role, content, meta: meta ? JSON.stringify(meta) : null }).lastInsertRowid;
  touch.run(sessionId);
  return db.prepare('SELECT id, role, content, meta, created_at FROM research_messages WHERE id = ?').get(id);
}

export const getMessages = (sessionId) =>
  db.prepare('SELECT role, content, meta FROM research_messages WHERE session_id = ? ORDER BY id').all(sessionId);

// ── distill → permanent knowledge node ───────────────────────────────────────
// Build the readable node body from the structured fields the agent produced.
function formatBody({ summary, keyConcepts = [], conclusions = [], openQuestions = [], sources = [] }) {
  const list = (arr) => arr.map((x) => `- ${x}`).join('\n');
  return [
    summary && `## Summary\n${summary}`,
    keyConcepts.length && `## Key concepts\n${list(keyConcepts)}`,
    conclusions.length && `## Conclusions\n${list(conclusions)}`,
    openQuestions.length && `## Open questions\n${list(openQuestions)}`,
    sources.length && `## Sources\n${list(sources)}`,
  ].filter(Boolean).join('\n\n');
}

/**
 * Persist a research node from the agent's structured output, in one
 * transaction: create the note (node_type='research', tagged by key concepts),
 * store its open questions, and mark the session saved + linked.
 */
export const saveResearchNode = db.transaction((sessionId, structured) => {
  const { topic, keyConcepts = [], openQuestions = [], parent_id = null } = structured;
  const note = createNote({
    title: topic || 'Research note',
    body: formatBody(structured),
    kind: 'note',
    node_type: 'research',
    source_agent: 'research',
    parent_id,
  });
  // key concepts become the node's tags → joins the shared-tag graph
  const tags = [...new Set(keyConcepts.map((c) => String(c).toLowerCase().trim()).filter(Boolean))].slice(0, 6);
  if (tags.length) setNoteTags(note.id, tags);
  // open questions split out for tracking
  const insOQ = db.prepare('INSERT INTO research_open_questions (note_id, question) VALUES (?, ?)');
  for (const q of openQuestions) if (String(q).trim()) insOQ.run(note.id, String(q).trim());

  db.prepare("UPDATE research_sessions SET status = 'saved', note_id = ?, topic = COALESCE(topic, ?), updated_at = datetime('now') WHERE id = ?")
    .run(note.id, topic || null, sessionId);

  return getNote(note.id);
});

// ── open questions (trackable over time) ─────────────────────────────────────
export function listOpenQuestions({ resolved = 0, limit = 100 } = {}) {
  return db.prepare(`
    SELECT q.id, q.question, q.resolved, q.created_at, q.note_id, n.title AS note_title
      FROM research_open_questions q LEFT JOIN notes n ON n.id = q.note_id
     WHERE q.resolved = ? ORDER BY q.created_at DESC LIMIT ?`).all(resolved ? 1 : 0, limit);
}

export function resolveQuestion(id, resolved = true) {
  return db.prepare('UPDATE research_open_questions SET resolved = ? WHERE id = ?').run(resolved ? 1 : 0, id).changes > 0;
}
