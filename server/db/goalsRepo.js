// ============================================================
//  Goals / check-ins / streaks — the accountability layer.
//
//  Owned primarily by the accountability agent, but goals are also
//  read by the council (personal context) and the morning brief
//  (interest signal). This module owns every read/write of the three
//  related tables (goals, checkins, streaks) so the agent, the route,
//  and any cross-agent reader share one source of truth.
//
//  STREAK MODEL: streaks is a cached aggregate the agent maintains. The
//  source of truth is the `checkins` rows; recomputeStreak() rebuilds the
//  cache from them so a streak is always reconstructable and never drifts.
//  A streak counts consecutive cadence periods (days or weeks) whose check-in
//  is 'done' or 'partial'; a 'missed' or an absent period breaks it.
// ============================================================
import db from './index.js';

// ── date helpers (UTC, ISO-8601 dates to match the schema defaults) ─────────
const isoDate = (d) => d.toISOString().slice(0, 10);
export const today = () => isoDate(new Date());

// difference in whole days between two YYYY-MM-DD strings (a - b)
function daysBetween(a, b) {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

// ── goals CRUD ──────────────────────────────────────────────────────────────
const insertGoal = db.prepare(`
  INSERT INTO goals (title, description, category, target, cadence, target_date, status)
  VALUES (@title, @description, @category, @target, @cadence, @target_date, @status)`);
const getGoalStmt = db.prepare('SELECT * FROM goals WHERE id = ?');
const deleteGoalStmt = db.prepare('DELETE FROM goals WHERE id = ?');

const VALID_STATUS = new Set(['active', 'paused', 'done', 'dropped']);
const VALID_CADENCE = new Set(['daily', 'weekly']);

export function createGoal({
  title, description = null, category = null, target = null,
  cadence = 'daily', target_date = null, status = 'active',
}) {
  if (!title || !String(title).trim()) throw new Error('Goal title is required');
  if (!VALID_CADENCE.has(cadence)) cadence = 'daily';
  if (!VALID_STATUS.has(status)) status = 'active';
  const info = insertGoal.run({
    title: String(title).trim(), description, category, target,
    cadence, target_date, status,
  });
  // every goal gets a streak row so reads never have to null-check it
  db.prepare('INSERT OR IGNORE INTO streaks (goal_id) VALUES (?)').run(info.lastInsertRowid);
  return getGoal(info.lastInsertRowid);
}

export function getGoal(id) {
  const goal = getGoalStmt.get(id);
  if (!goal) return null;
  const streak = db.prepare('SELECT * FROM streaks WHERE goal_id = ?').get(id) || null;
  return { ...goal, streak };
}

const ALLOWED_UPDATES = new Set([
  'title', 'description', 'category', 'target', 'cadence', 'target_date', 'status',
]);
export function updateGoal(id, patch = {}) {
  const fields = Object.keys(patch).filter((k) => ALLOWED_UPDATES.has(k));
  if (!fields.length) return getGoal(id);
  if (patch.status && !VALID_STATUS.has(patch.status)) throw new Error(`invalid status: ${patch.status}`);
  if (patch.cadence && !VALID_CADENCE.has(patch.cadence)) throw new Error(`invalid cadence: ${patch.cadence}`);
  const set = fields.map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE goals SET ${set} WHERE id = @id`).run({ id, ...patch });
  return getGoal(id);
}

export function deleteGoal(id) {
  return deleteGoalStmt.run(id).changes > 0; // checkins + streaks cascade via FK
}

/** Active goals (default) or by status, each with its cached streak. */
export function listGoals({ status = 'active', limit = 100 } = {}) {
  const goals = status
    ? db.prepare('SELECT * FROM goals WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
    : db.prepare('SELECT * FROM goals ORDER BY created_at DESC LIMIT ?').all(limit);
  if (!goals.length) return [];
  const streaks = db.prepare(
    `SELECT * FROM streaks WHERE goal_id IN (${goals.map(() => '?').join(',')})`
  ).all(...goals.map((g) => g.id));
  const byGoal = new Map(streaks.map((s) => [s.goal_id, s]));
  return goals.map((g) => ({ ...g, streak: byGoal.get(g.id) || null }));
}

// ── check-ins ────────────────────────────────────────────────────────────────
// One check-in per goal per day (UNIQUE goal_id+checkin_date). An UPSERT lets a
// later check-in correct an earlier one for the same day (e.g. user marks done
// after the agent logged a miss).
const upsertCheckin = db.prepare(`
  INSERT INTO checkins (goal_id, checkin_date, status, note, source_agent)
  VALUES (@goal_id, @checkin_date, @status, @note, @source_agent)
  ON CONFLICT (goal_id, checkin_date) DO UPDATE SET
    status = excluded.status,
    note = excluded.note,
    source_agent = excluded.source_agent`);

const VALID_CHECKIN = new Set(['done', 'partial', 'missed']);

/** Record (or correct) a check-in, then refresh the cached streak. */
export function recordCheckin({
  goal_id, checkin_date = today(), status = 'done', note = null, source_agent = 'user',
}) {
  if (!getGoalStmt.get(goal_id)) throw new Error(`goal ${goal_id} not found`);
  if (!VALID_CHECKIN.has(status)) throw new Error(`invalid check-in status: ${status}`);
  upsertCheckin.run({ goal_id, checkin_date, status, note, source_agent });
  const streak = recomputeStreak(goal_id);
  return { checkin: getCheckin(goal_id, checkin_date), streak };
}

const getCheckin = (goalId, date) =>
  db.prepare('SELECT * FROM checkins WHERE goal_id = ? AND checkin_date = ?').get(goalId, date);

export function listCheckins(goalId, limit = 60) {
  return db.prepare(
    'SELECT * FROM checkins WHERE goal_id = ? ORDER BY checkin_date DESC LIMIT ?'
  ).all(goalId, limit);
}

/** Goals with no check-in logged yet for `date` — the agent's nudge candidates. */
export function goalsNeedingCheckin(date = today()) {
  return db.prepare(`
    SELECT g.* FROM goals g
    WHERE g.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM checkins c WHERE c.goal_id = g.id AND c.checkin_date = ?
      )
    ORDER BY g.created_at DESC`).all(date);
}

// ── streak recomputation (cache rebuild from checkins) ───────────────────────
const PERIOD_DAYS = { daily: 1, weekly: 7 };

/**
 * Rebuild the cached streak for one goal from its check-in history.
 * Walks check-ins newest→oldest counting consecutive kept periods.
 *   - current_count: the live streak — kept periods running back from the most
 *     recent check-in, but only if that check-in is recent enough (within one
 *     cadence period of today) and unbroken. The first gap/miss freezes it.
 *   - longest_count: the longest such run anywhere in the history.
 * A 'missed' status or a gap larger than one cadence period breaks a run.
 */
export function recomputeStreak(goalId) {
  const goal = getGoalStmt.get(goalId);
  if (!goal) return null;
  const period = PERIOD_DAYS[goal.cadence] || 1;

  // newest-first; a run is consecutive kept check-ins spaced ≤ one period apart
  const rows = db.prepare(
    `SELECT checkin_date, status FROM checkins WHERE goal_id = ? ORDER BY checkin_date DESC`
  ).all(goalId);

  let current = 0;
  let longest = 0;
  let run = 0;
  let currentAlive = true; // false once the backward walk hits the first break
  let prevDate = null;

  for (const row of rows) {
    const kept = row.status === 'done' || row.status === 'partial';
    let consecutive;
    if (prevDate === null) {
      // anchor: the live streak exists only if the latest kept check-in is
      // within one period of today (otherwise today's period is already missed)
      consecutive = kept && daysBetween(today(), row.checkin_date) <= period;
    } else {
      const gap = daysBetween(prevDate, row.checkin_date);
      consecutive = kept && gap > 0 && gap <= period;
    }

    if (consecutive) {
      run += 1;
      if (currentAlive) current += 1;
    } else {
      run = kept ? 1 : 0;     // a kept-but-non-consecutive row starts a fresh run
      currentAlive = false;   // the live streak can't grow past a break
    }
    longest = Math.max(longest, run);
    prevDate = row.checkin_date;
  }

  db.prepare(`
    UPDATE streaks
       SET current_count = ?, longest_count = ?, last_checkin_date = ?, updated_at = datetime('now')
     WHERE goal_id = ?`).run(current, longest, rows[0]?.checkin_date || null, goalId);
  return db.prepare('SELECT * FROM streaks WHERE goal_id = ?').get(goalId);
}
