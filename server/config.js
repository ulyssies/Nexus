// ============================================================
//  Nexus agent configuration — static settings the job agent reads.
//
//  This is the single source for "what to search, where, and against
//  which résumé". The external job-agent kept an editable settings table
//  in SQLite; Nexus keeps it as plain config (one user, local-only) so
//  the agent is trivial to reason about and reproduce. Edit this file to
//  change target cities, search terms, or résumé paths.
//
//  Paths resolve relative to server/ so Nexus is fully self-contained —
//  nothing reaches outside the repo.
// ============================================================
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resume = (f) => join(__dirname, 'resumes', f);

// Cities the agent searches on Adzuna (one query per city × title).
export const TARGET_CITIES = [
  { city: 'Atlanta',     state: 'GA', adzunaRegion: 'us' },
  { city: 'Austin',      state: 'TX', adzunaRegion: 'us' },
  { city: 'Seattle',     state: 'WA', adzunaRegion: 'us' },
  { city: 'Denver',      state: 'CO', adzunaRegion: 'us' },
  { city: 'Boulder',     state: 'CO', adzunaRegion: 'us' },
  { city: 'Chicago',     state: 'IL', adzunaRegion: 'us' },
  { city: 'Portland',    state: 'OR', adzunaRegion: 'us' },
  { city: 'New York',    state: 'NY', adzunaRegion: 'us' },
  { city: 'Raleigh',     state: 'NC', adzunaRegion: 'us' },
  { city: 'Charlotte',   state: 'NC', adzunaRegion: 'us' },
  { city: 'Houston',     state: 'TX', adzunaRegion: 'us' },
  { city: 'Dallas',      state: 'TX', adzunaRegion: 'us' },
  { city: 'San Antonio', state: 'TX', adzunaRegion: 'us' },
];

// Search terms, split by track. Track determines which résumé scores the job.
export const DA_JOB_TITLES = [
  'Data Analyst',
  'Data Engineer',
  'Junior Data Analyst',
  'Associate Data Analyst',
  'Analytics Engineer',
  'Business Intelligence Analyst',
  'AI Analyst',
];

export const SWE_JOB_TITLES = [
  'Software Engineer',
  'Full Stack Developer',
  'Associate Software Engineer',
  'AI Engineer',
  'Associate AI Engineer',
  'Automation Engineer',
  'Backend Developer',
  'Application Developer',
];

export const JOB_TITLES = [...DA_JOB_TITLES, ...SWE_JOB_TITLES];

const DA_KEYWORDS = [
  'data analyst', 'data engineer', 'analytics engineer',
  'business intelligence', 'bi analyst', 'ai analyst',
];

/** Classify a listing as 'da' or 'swe' from its title — picks the résumé. */
export function getJobTrack(title) {
  const lower = String(title || '').toLowerCase();
  return DA_KEYWORDS.some((kw) => lower.includes(kw)) ? 'da' : 'swe';
}

// Résumés the scorer compares against (copied into the repo — self-contained).
export const RESUME_PATHS = { da: resume('da_resume.tex'), swe: resume('swe_resume.tex') };

// Scoring / filtering knobs.
export const MIN_MATCH_PERCENT = 60;   // a listing below this is "not a match" in summaries
export const MAX_JOB_AGE_DAYS = 14;    // drop listings older than this (kept if no date)
export const SCORE_BATCH_SIZE = 10;    // jobs per Claude scoring call
export const SCORING_MODEL = 'claude-sonnet-4-6'; // bulk classification — Sonnet, not Opus

// Title fragments that mark a listing as too senior / out of scope.
export const EXCLUDED_KEYWORDS = [
  'Senior', 'Sr.', 'Lead', 'Principal', 'Staff', 'Manager', 'Director',
  'Head of', 'VP', '10+ years', '9+ years', '8+ years', '7+ years',
  '6+ years', '5+ years', '4+ years', '3+ years', 'C++', 'Kubernetes',
  'PhD', 'MBA', 'Clearance', 'sponsorship', 'Top Secret', 'Secret',
  'Confidential', 'TS/SCI',
];

// node-cron schedule: 07:00 daily. Registered on server boot. (Adzuna free tier
// is 250 calls/day and a full run is slow + rate-limited, so daily is the
// tightest sane cadence — listings don't churn fast enough to scan more often.)
export const JOB_AGENT_CRON = '0 7 * * *';
// Master switch for all AUTOMATIC job runs (the daily cron AND the boot
// catch-up). Disabled for now — the job agent only runs when you press
// "run now" in the Jobs view. Flip back to true to re-enable scheduling.
export const JOB_AGENT_CRON_ENABLED = false;
// Local-machine catch-up: when the server boots after sleep/offline time,
// run the job agent if the last successful scan/import is older than this.
export const JOB_AGENT_CATCHUP_HOURS = 20;

// Accountability check-in: 20:00 daily. Refreshes streaks + builds the nudge.
export const ACCOUNTABILITY_CRON = '0 20 * * *';

// ── PROJECT ARCHIVIST ────────────────────────────────────────────────────────
// Absolute local folder paths the archivist watches. These are the ONLY
// directories the agent ever touches — filesystem reach is sandboxed to this
// list (it's why Nexus stays local-only). Each entry: { name, path, type }.
// Defaults to the Nexus repo itself (parent of server/) so the feature works
// out of the box; edit/extend with your own repos. Set NEXUS_REPO_ROOT to
// override the default path.
const repoRoot = join(__dirname, '..');
export const WATCHED_PROJECTS = [
  { name: 'nexus', path: process.env.NEXUS_REPO_ROOT || repoRoot, type: 'app' },
  // { name: 'my-other-project', path: '/Users/you/code/other', type: 'library' },
];

// Archivist git-log poll: every 30 minutes. A chokidar watch on each repo's
// .git/logs/HEAD also triggers a debounced scan so commits land promptly.
export const ARCHIVIST_CRON = '*/10 * * * *';

// ── MORNING BRIEF ────────────────────────────────────────────────────────────
// Curated daily digest. Interests are learned from notes/tags + goals; news is
// fetched from NewsAPI (NEWS_API_KEY in .env, free dev tier at newsapi.org) and
// condensed with Claude. Degrades gracefully with no key (empty digest + note).
export const BRIEF_CRON = '0 6,12,18 * * *';  // 06:00 / 12:00 / 18:00 — refresh through the day (aligns with the 6h digest-cache TTL)
export const BRIEF_ARTICLE_COUNT = 9;        // headlines to curate per morning (from a larger multi-topic candidate pool)
export const BRIEF_LOOKBACK_DAYS = 3;        // how fresh the news must be

// ── EMAIL AGENT (Gmail, read-only) ───────────────────────────────────────────
// Reads Gmail via OAuth with the gmail.readonly scope ONLY — Nexus never sends
// or deletes mail. credentials.json (OAuth Desktop creds from Google Cloud)
// and the cached token live in server/ and are gitignored. Run the one-time
// `npm run gmail:auth` to authorize; the agent degrades gracefully until then.
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
export const GMAIL_CREDENTIALS_PATH = join(__dirname, 'credentials.json');
export const GMAIL_TOKEN_PATH = join(__dirname, 'gmail-token.json');
export const EMAIL_CRON = '*/15 * * * *';    // every 15 min — cheap: flagExists() skips already-classified mail, so a Claude call only fires when new mail arrives
export const EMAIL_SCAN_COUNT = 20;          // most recent messages to classify per run
