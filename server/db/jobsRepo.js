// ============================================================
//  Shared write layer for the `jobs` table.
//
//  Both the one-time jobs.json migration and the live job agent land
//  rows here, so the upsert lives in exactly one place. Semantics:
//   - dedup key is (source, external_id); external_id is a stable hash
//     of applyLink|title|company so a live re-fetch updates the SAME row
//     a prior migration created instead of duplicating it.
//   - scoring fields always refresh.
//   - a status the user or email agent advanced past 'new' is preserved;
//     the writer only sets status while the row is still untouched.
// ============================================================
import crypto from 'node:crypto';
import db from './index.js';

// Stable id for a listing — mirrors the external job-agent's makeJobId so
// migrated rows and freshly fetched rows collide (and merge) correctly.
export function makeJobId(job) {
  const raw = [job.applyLink || job.url, job.title, job.company]
    .filter(Boolean).join('|').toLowerCase();
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

const SOURCE_MAP = {
  adzuna: 'adzuna',
  jobicy: 'jobicy',
  'the muse': 'muse',
  muse: 'muse',
  'external url': 'external',
};
export const normSource = (s) =>
  SOURCE_MAP[String(s || '').toLowerCase().trim()] || 'external';

const STATUS_MAP = { applied: 'applied', withdrawn: 'withdrawn' };
export const normStatus = (s) =>
  STATUS_MAP[String(s || '').toLowerCase().trim()] || 'new';

// Title-company dedup set, matching the external agent's fetch filter so a
// re-run only fetches/scores listings we have not seen. Rows that never got
// a substantial description are intentionally fetchable again so a later provider
// response can hydrate the board instead of leaving blank detail panels.
export function getSeenJobKeys() {
  const rows = db.prepare(`
    SELECT title, company
      FROM jobs
     WHERE length(trim(COALESCE(description, ''))) >= 400
  `).all();
  return new Set(rows.map((r) => `${r.title}-${r.company}`.toLowerCase().replace(/\s+/g, '')));
}

const upsertStmt = db.prepare(`
  INSERT INTO jobs (
    external_id, source, track, title, company, location, target_city,
    url, description, salary, posted_at, match_score, match_category,
    match_reasons, entry_level_fit, status, status_updated_at, status_updated_by
  ) VALUES (
    @external_id, @source, @track, @title, @company, @location, @target_city,
    @url, @description, @salary, @posted_at, @match_score, @match_category,
    @match_reasons, @entry_level_fit, @status, @status_updated_at, @status_updated_by
  )
  ON CONFLICT(source, external_id) DO UPDATE SET
    track          = excluded.track,
    title          = excluded.title,
    company        = excluded.company,
    location       = excluded.location,
    target_city    = excluded.target_city,
    url            = excluded.url,
    description    = CASE
                       WHEN length(trim(COALESCE(excluded.description, ''))) > length(trim(COALESCE(jobs.description, '')))
                       THEN excluded.description
                       ELSE jobs.description
                     END,
    salary         = COALESCE(NULLIF(excluded.salary, ''), jobs.salary),
    posted_at      = excluded.posted_at,
    match_score    = excluded.match_score,
    match_category = excluded.match_category,
    match_reasons  = excluded.match_reasons,
    entry_level_fit= excluded.entry_level_fit,
    -- preserve a status the user/email agent already advanced; only set
    -- status while the row is still untouched ('new').
    status            = CASE WHEN jobs.status = 'new' THEN excluded.status ELSE jobs.status END,
    status_updated_at = CASE WHEN jobs.status = 'new' THEN excluded.status_updated_at ELSE jobs.status_updated_at END,
    status_updated_by = CASE WHEN jobs.status = 'new' THEN excluded.status_updated_by ELSE jobs.status_updated_by END,
    updated_at     = datetime('now')
`);

const touchSeenStmt = db.prepare(`
  INSERT INTO job_seen_keys (source, external_id)
  VALUES (@source, @external_id)
  ON CONFLICT(source, external_id) DO UPDATE SET
    last_seen_at = datetime('now')
`);

/**
 * Upsert one fully-built job row. Fields not supplied default to null/new.
 * Callers pass snake_case keys matching the columns above.
 */
export function upsertJob(record) {
  upsertStmt.run({
    external_id: null, source: 'external', track: null, title: '(untitled)',
    company: '(unknown)', location: null, target_city: null, url: null,
    description: null, salary: null, posted_at: null, match_score: null,
    match_category: null, match_reasons: '{}', entry_level_fit: 0,
    status: 'new', status_updated_at: null, status_updated_by: null,
    ...record,
  });
}

/** Upsert many rows in a single transaction. Returns the count written. */
export const upsertJobs = db.transaction((records) => {
  for (const r of records) {
    const source = r.source || 'external';
    if (r.external_id) touchSeenStmt.run({ source, external_id: r.external_id });
    upsertJob(r);
  }
  return records.length;
});
