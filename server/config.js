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

// node-cron schedule: 07:00 every 3rd day. Registered on server boot.
export const JOB_AGENT_CRON = '0 7 */3 * *';
