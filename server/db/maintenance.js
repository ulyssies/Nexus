// ============================================================
//  DB maintenance — retention sweeps over the shared context layer.
//
//  purgeStaleJobs: drop unapplied job listings that have sat in Nexus
//  for too long. "Unapplied" means status is still 'new' — anything the
//  user or the email agent has advanced (applied, interviewing, offer,
//  rejected, withdrawn, archived, interested) is application history and
//  is always kept. Age is measured by created_at (when the row first
//  entered the db), which is stable across re-imports — the migration
//  upsert never rewrites created_at — so this reads as "I've had N days
//  to apply and didn't."
//
//  Designed to be called from both the manual CLI script and the Phase-2
//  job-agent cron, so the policy lives in exactly one place.
// ============================================================
import db from './index.js';

/**
 * Delete unapplied ('new') jobs older than `days` by created_at.
 * @param {object}  [opts]
 * @param {number}  [opts.days=30]     age threshold in days
 * @param {boolean} [opts.dryRun=false] count only, delete nothing
 * @returns {{ deleted: number, days: number, dryRun: boolean }}
 */
export function purgeStaleJobs({ days = 30, dryRun = false } = {}) {
  const where = `
    WHERE status = 'new'
      AND julianday('now') - julianday(created_at) > @days
  `;

  if (dryRun) {
    const deleted = db.prepare(`SELECT COUNT(*) n FROM jobs ${where}`).get({ days }).n;
    return { deleted, days, dryRun: true };
  }

  const info = db.prepare(`DELETE FROM jobs ${where}`).run({ days });
  return { deleted: info.changes, days, dryRun: false };
}
