// ============================================================
//  ONE-TIME MIGRATION: job-agent jobs.json  ->  SQLite `jobs`
//
//  Usage (pass the legacy file path explicitly — Nexus keeps no default
//  pointing outside the repo, so it depends on no external folder):
//    node scripts/migrate-jobs.js path/to/jobs.json
//    JOBS_JSON_PATH=/abs/path node scripts/migrate-jobs.js
//
//  The job-agent writes data/jobs.json as { runs: [ { date, timestamp,
//  results: [...] }, ... ] }, newest run first. We flatten every run,
//  dedup by jobId (newest occurrence wins), and upsert. Re-running is
//  safe: scoring fields refresh; a status the user/email agent already
//  advanced past 'new' is preserved.
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import db from '../db/index.js';
import { normSource, normStatus, upsertJobs } from '../db/jobsRepo.js';

const jsonPath = process.argv[2] || process.env.JOBS_JSON_PATH;

if (!jsonPath) {
  console.error('✗ No jobs.json path given.');
  console.error('  Usage: node scripts/migrate-jobs.js /path/to/jobs.json');
  process.exit(1);
}
if (!existsSync(jsonPath)) {
  console.error(`✗ jobs.json not found at: ${jsonPath}`);
  process.exit(1);
}

// ---- load + flatten + dedup --------------------------------------------
const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
const runs = Array.isArray(data) ? data : data.runs || (data.results ? [data] : []);
if (!runs.length) {
  console.error('✗ No runs found in jobs.json (expected { runs: [...] }).');
  process.exit(1);
}

// runs are newest-first; keep the FIRST time we see each jobId.
const byId = new Map();
for (const run of runs) {
  for (const j of run.results || []) {
    if (j && j.jobId && !byId.has(j.jobId)) {
      byId.set(j.jobId, { job: j, runTimestamp: run.timestamp || null });
    }
  }
}
const jobs = [...byId.values()];
console.log(`Loaded ${runs.length} runs → ${jobs.length} unique jobs from ${jsonPath}`);

// ---- upsert (shared write layer, identical to the live agent) -----------
const records = jobs.map(({ job: j, runTimestamp }) => {
  const status = normStatus(j.applicationStatus);
  return {
    external_id: String(j.jobId),
    source: normSource(j.source),
    track: j.track || null,
    title: j.title || '(untitled)',
    company: j.company || '(unknown)',
    location: j.location || null,
    target_city: j.targetCity || null,
    url: j.applyLink || null,
    description: j.description || null,
    salary: j.salary || j.estimatedSalary || null,
    posted_at: j.postedAt || null,
    match_score: typeof j.matchPercent === 'number' ? j.matchPercent : null,
    match_category: j.matchCategory || null,
    match_reasons: JSON.stringify({
      reason: j.reason || null,
      missingSkills: Array.isArray(j.missingSkills) ? j.missingSkills : [],
    }),
    entry_level_fit: j.entryLevelFit === true ? 1 : 0,
    status,
    status_updated_at: status === 'new' ? null : runTimestamp,
    status_updated_by: status === 'new' ? null : 'import',
  };
});
const inserted = upsertJobs(records);

// ---- report -------------------------------------------------------------
const total = db.prepare('SELECT COUNT(*) n FROM jobs').get().n;
const byStatus = db.prepare('SELECT status, COUNT(*) n FROM jobs GROUP BY status ORDER BY n DESC').all();
const entry = db.prepare('SELECT COUNT(*) n FROM jobs WHERE entry_level_fit = 1').get().n;
console.log(`✓ Upserted ${inserted} rows. jobs table now holds ${total} rows.`);
console.log(`  entry-level fit: ${entry}`);
console.log(`  by status: ${byStatus.map((r) => `${r.status}=${r.n}`).join('  ')}`);
