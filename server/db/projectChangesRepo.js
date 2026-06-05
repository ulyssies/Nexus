// ============================================================
//  Project changes — the archivist's write layer.
//
//  Each recorded change is two things at once:
//    1. a row in project_changes (the queryable history), and
//    2. a note (kind='project', source_agent='archivist') so the change
//       becomes a NODE in the second-brain graph — which is the whole point
//       of the archivist ("feeds the second brain"). The note_id FK links
//       the two so a graph node can be traced back to its commit.
//
//  Owns all project_changes access. Reuses notesRepo.createNote so project
//  notes flow through the same tagging/graph path as journal entries.
// ============================================================
import db from './index.js';
import { createNote } from './notesRepo.js';

const insertChange = db.prepare(`
  INSERT INTO project_changes
    (project_name, project_path, change_type, commit_hash, summary, why, impact, diff_stat, note_id, changed_at)
  VALUES
    (@project_name, @project_path, @change_type, @commit_hash, @summary, @why, @impact, @diff_stat, @note_id, @changed_at)
  ON CONFLICT (project_name, commit_hash) DO NOTHING`);

const existsStmt = db.prepare(
  'SELECT 1 FROM project_changes WHERE project_name = ? AND commit_hash = ?');

/** Has this commit already been recorded for this project? (dedup guard) */
export const hasCommit = (projectName, hash) => !!existsStmt.get(projectName, hash);

/**
 * Record one change + its graph node. The note carries the human-readable
 * summary so the second brain shows what happened; the row carries structure.
 * Returns the new change row (or null if it was already recorded).
 */
export function recordChange({
  project_name, project_path = null, change_type = 'commit', commit_hash = null,
  summary, why = null, impact = null, diff_stat = null, changed_at = null,
}) {
  if (!summary || !String(summary).trim()) throw new Error('change summary is required');
  if (commit_hash && hasCommit(project_name, commit_hash)) return null;

  // graph node first so we can link it; body = the readable story of the change
  const noteBody = [
    `${project_name}${commit_hash ? ` · ${commit_hash.slice(0, 7)}` : ''}`,
    summary,
    why ? `Why: ${why}` : null,
    impact ? `Impact: ${impact}` : null,
  ].filter(Boolean).join('\n');
  const note = createNote({
    title: `${project_name}: ${summary.slice(0, 60)}`,
    body: noteBody,
    kind: 'project',
    source_agent: 'archivist',
  });

  const info = insertChange.run({
    project_name, project_path, change_type, commit_hash,
    summary, why, impact, diff_stat, note_id: note.id, changed_at,
  });
  if (!info.changes) return null; // lost a race; conflict ignored
  return db.prepare('SELECT * FROM project_changes WHERE id = ?').get(info.lastInsertRowid);
}

/** Recent changes for one project, newest first. */
export function listChanges(projectName, limit = 30) {
  return db.prepare(
    'SELECT * FROM project_changes WHERE project_name = ? ORDER BY changed_at DESC, id DESC LIMIT ?'
  ).all(projectName, limit);
}

/** Per-project summary cards: name, path, change count, last change time. */
export function listProjects() {
  return db.prepare(`
    SELECT project_name, project_path,
           COUNT(*) AS change_count,
           MAX(changed_at) AS last_changed_at
      FROM project_changes
     GROUP BY project_name
     ORDER BY last_changed_at DESC`).all();
}
