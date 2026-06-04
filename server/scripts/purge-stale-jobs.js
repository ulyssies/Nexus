// ============================================================
//  Manual retention sweep: delete unapplied jobs older than N days.
//
//  Usage:
//    node scripts/purge-stale-jobs.js              # delete, 30-day default
//    node scripts/purge-stale-jobs.js --dry-run    # count only, delete nothing
//    node scripts/purge-stale-jobs.js --days=45     # custom threshold
//
//  Only touches status='new' rows — applied/advanced jobs are kept.
//  Phase-2 cron will call purgeStaleJobs() directly instead of this CLI.
// ============================================================
import { purgeStaleJobs } from '../db/maintenance.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const daysArg = args.find((a) => a.startsWith('--days='));
const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 30;

if (Number.isNaN(days) || days < 0) {
  console.error(`✗ invalid --days value: ${daysArg}`);
  process.exit(1);
}

const { deleted } = purgeStaleJobs({ days, dryRun });

if (dryRun) {
  console.log(`[dry run] ${deleted} unapplied job(s) older than ${days}d would be deleted.`);
} else {
  console.log(`✓ Deleted ${deleted} unapplied job(s) older than ${days}d (status='new' only).`);
}
