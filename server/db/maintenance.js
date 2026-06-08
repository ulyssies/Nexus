// ============================================================
//  DB maintenance — retention sweeps over the shared context layer.
//
//  purgeStaleJobs: drop stale discovered listings that have no application
//  data. Anything with applied_at, status_updated_at, or a status advanced
//  by the user/email agent is kept. Age is measured by the listing's
//  posted_at when available, falling back to created_at.
//
//  Designed to be called from both the manual CLI script and the Phase-2
//  job-agent cron, so the policy lives in exactly one place.
// ============================================================
import db from './index.js';

/**
 * Delete untouched ('new') jobs older than `days` by posted_at/created_at.
 * @param {object}  [opts]
 * @param {number}  [opts.days=30]     age threshold in days
 * @param {boolean} [opts.dryRun=false] count only, delete nothing
 * @returns {{ deleted: number, days: number, dryRun: boolean }}
 */
export function purgeStaleJobs({ days = 30, dryRun = false } = {}) {
  const where = `
    WHERE status = 'new'
      AND applied_at IS NULL
      AND status_updated_at IS NULL
      AND julianday('now') - julianday(COALESCE(posted_at, created_at)) > @days
  `;

  if (dryRun) {
    const deleted = db.prepare(`SELECT COUNT(*) n FROM jobs ${where}`).get({ days }).n;
    return { deleted, days, dryRun: true };
  }

  const info = db.prepare(`DELETE FROM jobs ${where}`).run({ days });
  return { deleted: info.changes, days, dryRun: false };
}
