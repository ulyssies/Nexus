// ============================================================
//  Morning brief — the daily digest write/read layer.
//
//  One morning_brief row per day (UNIQUE brief_date) with N ordered
//  morning_brief_items. The brief agent learns interests from the same
//  notes/tags the second brain holds, so the digest is personal. This
//  module owns both tables; the agent and the home view share it.
// ============================================================
import db from './index.js';

const upsertBrief = db.prepare(`
  INSERT INTO morning_brief (brief_date, summary) VALUES (@brief_date, @summary)
  ON CONFLICT (brief_date) DO UPDATE SET summary = excluded.summary, generated_at = datetime('now')`);

const insertItem = db.prepare(`
  INSERT INTO morning_brief_items (brief_id, headline, source_url, summary, topic, position)
  VALUES (@brief_id, @headline, @source_url, @summary, @topic, @position)`);

const clearItems = db.prepare('DELETE FROM morning_brief_items WHERE brief_id = ?');

/**
 * Replace today's brief (summary + ordered items) in one transaction so the
 * home view never reads a half-written digest.
 */
export const saveBrief = db.transaction(({ brief_date, summary, items = [] }) => {
  upsertBrief.run({ brief_date, summary });
  const brief = db.prepare('SELECT * FROM morning_brief WHERE brief_date = ?').get(brief_date);
  clearItems.run(brief.id);
  items.forEach((it, i) => insertItem.run({
    brief_id: brief.id,
    headline: it.headline,
    source_url: it.source_url || null,
    summary: it.summary || null,
    topic: it.topic || null,
    position: i,
  }));
  return getBrief(brief_date);
});

/** A brief with its items, or null. Defaults to today. */
export function getBrief(date) {
  const brief = date
    ? db.prepare('SELECT * FROM morning_brief WHERE brief_date = ?').get(date)
    : db.prepare('SELECT * FROM morning_brief ORDER BY brief_date DESC LIMIT 1').get();
  if (!brief) return null;
  const items = db.prepare(
    'SELECT * FROM morning_brief_items WHERE brief_id = ? ORDER BY position'
  ).all(brief.id);
  return { ...brief, items };
}

/**
 * The user's top interests, learned from the second brain: most-used note tags
 * plus active goal titles/categories. These become the news search terms — the
 * digest is curated to what they actually think and work on.
 */
export function learnInterests(limit = 5) {
  const tags = db.prepare(`
    SELECT t.name, COUNT(*) AS c
      FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
     GROUP BY t.id ORDER BY c DESC, t.name LIMIT ?`).all(limit).map((r) => r.name);

  let goalTerms = [];
  try {
    goalTerms = db.prepare(
      "SELECT category FROM goals WHERE status = 'active' AND category IS NOT NULL"
    ).all().map((r) => r.category);
  } catch { /* goals may be empty */ }

  // de-dupe (case-insensitive), keep order: tags first (strongest signal)
  const seen = new Set();
  const interests = [];
  for (const term of [...tags, ...goalTerms]) {
    const key = String(term).toLowerCase().trim();
    if (key && !seen.has(key)) { seen.add(key); interests.push(term); }
  }
  return interests.slice(0, limit);
}

// ── user-steered interests (Settings → brief tags) ──────────────────────────
// Clickable topic tags the user adds to direct the news search WITHOUT editing
// config. Active ones are merged ahead of the auto-learned interests.
const insertInterest = db.prepare(
  'INSERT INTO brief_interests (label) VALUES (?) ON CONFLICT(label) DO UPDATE SET active = 1');

export function listInterests() {
  return db.prepare('SELECT id, label, active, created_at FROM brief_interests ORDER BY created_at DESC').all();
}

export function addInterest(label) {
  const clean = String(label || '').trim();
  if (!clean) throw new Error('interest label is required');
  insertInterest.run(clean);
  return db.prepare('SELECT id, label, active, created_at FROM brief_interests WHERE label = ? COLLATE NOCASE').get(clean);
}

export function toggleInterest(id) {
  db.prepare('UPDATE brief_interests SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  return db.prepare('SELECT id, label, active FROM brief_interests WHERE id = ?').get(id);
}

export function deleteInterest(id) {
  return db.prepare('DELETE FROM brief_interests WHERE id = ?').run(id).changes > 0;
}

const activeInterestLabels = () =>
  db.prepare('SELECT label FROM brief_interests WHERE active = 1 ORDER BY created_at DESC').all().map((r) => r.label);

/**
 * The interests the morning brief actually searches on: the user's active
 * picks first (explicit steering), then the auto-learned ones, deduped.
 */
export function effectiveInterests() {
  const user = activeInterestLabels();
  const learned = learnInterests(6);
  const seen = new Set();
  const out = [];
  for (const term of [...user, ...learned]) {
    const key = String(term).toLowerCase().trim();
    if (key && !seen.has(key)) { seen.add(key); out.push(term); }
  }
  return out.slice(0, 8);
}
