// Nexus backend — the single long-running Express process that will host
// the REST API, all agents, schedulers, and watchers. For this slice it
// only serves the read-only Job board API. Agents/cron come in later phases.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import jobsRouter from './routes/jobs.js';
import notesRouter from './routes/notes.js';
import councilRouter from './routes/council.js';
import accountabilityRouter from './routes/accountability.js';
import projectsRouter from './routes/projects.js';
import briefRouter from './routes/brief.js';
import emailRouter from './routes/email.js';
import calendarRouter from './routes/calendar.js';
import overviewRouter, { homeRouter } from './routes/overview.js';
import observabilityRouter from './routes/observability.js';
import researchRouter from './routes/research.js';
import db, { DB_PATH } from './db/index.js';
import { runJobAgent } from './agents/jobAgent.js';
import { runAccountability } from './agents/accountabilityAgent.js';
import { runArchivist, startWatchers } from './agents/archivistAgent.js';
import { runMorningBrief } from './agents/morningBriefAgent.js';
import { runEmailAgent } from './agents/emailAgent.js';
import { purgeStaleJobs } from './db/maintenance.js';
import {
  JOB_AGENT_CRON, JOB_AGENT_CATCHUP_HOURS, ACCOUNTABILITY_CRON,
  ARCHIVIST_CRON, BRIEF_CRON, EMAIL_CRON,
} from './config.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors()); // local-only; the Vite dev server (5173) calls this
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true, db: DB_PATH }));
app.use('/api/jobs', jobsRouter);
app.use('/api/notes', notesRouter);
app.use('/api/council', councilRouter);
app.use('/api/accountability', accountabilityRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/brief', briefRouter);
app.use('/api/email', emailRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/overview', overviewRouter);
app.use('/api/home', homeRouter);
app.use('/api/observability', observabilityRouter);
app.use('/api/research', researchRouter);

function parseDbTime(value) {
  if (!value) return null;
  const normalized = String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function lastJobScanAt() {
  const run = db.prepare(`
    SELECT MAX(COALESCE(finished_at, started_at)) value
      FROM agent_runs
     WHERE agent = 'job'
       AND (
         status = 'ok'
         OR (status = 'running' AND julianday('now') - julianday(started_at) < (2.0 / 24.0))
       )
  `).get()?.value;
  const imported = db.prepare(`
    SELECT MAX(created_at) value
      FROM jobs
  `).get()?.value;
  return parseDbTime(run || imported);
}

async function runJobCatchupIfDue() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[boot] job catch-up skipped: ANTHROPIC_API_KEY is not set');
    return;
  }

  const last = lastJobScanAt();
  const ageHours = last ? (Date.now() - last.getTime()) / 36e5 : Infinity;
  if (ageHours < JOB_AGENT_CATCHUP_HOURS) {
    console.log(`[boot] job catch-up skipped: last scan ${ageHours.toFixed(1)}h ago`);
    return;
  }

  console.log(`[boot] job catch-up due: last scan ${last ? `${ageHours.toFixed(1)}h ago` : 'never'}`);
  try {
    await runJobAgent({ trigger: 'boot' });
    const { deleted } = purgeStaleJobs({ days: 30 });
    if (deleted) console.log(`[boot] purged ${deleted} stale untouched jobs`);
  } catch (e) {
    console.error(`[boot] job catch-up failed: ${e.message}`);
  }
}

app.listen(PORT, () => {
  console.log(`Nexus server on http://localhost:${PORT}  (db: ${DB_PATH})`);

  // Schedules register in-process and persist as long as this process runs —
  // the whole reason the backend is one long-lived Express process.
  cron.schedule(JOB_AGENT_CRON, async () => {
    try {
      await runJobAgent({ trigger: 'cron' });
      // Each run also sweeps unapplied listings older than 30 days.
      const { deleted } = purgeStaleJobs({ days: 30 });
      if (deleted) console.log(`[cron] purged ${deleted} stale unapplied jobs`);
    } catch (e) {
      console.error(`[cron] job agent run failed: ${e.message}`);
    }
  });
  console.log(`Job agent cron registered: "${JOB_AGENT_CRON}" (07:00 every 3rd day)`);
  setTimeout(() => { runJobCatchupIfDue(); }, 5000);

  // Accountability: nightly streak refresh + check-in nudge. Pure local
  // (no external key needed); the nudge degrades to a template without one.
  cron.schedule(ACCOUNTABILITY_CRON, async () => {
    try {
      await runAccountability({ trigger: 'cron' });
    } catch (e) {
      console.error(`[cron] accountability run failed: ${e.message}`);
    }
  });
  console.log(`Accountability cron registered: "${ACCOUNTABILITY_CRON}" (20:00 daily)`);

  // Project archivist: poll git history every 30 min, and watch each repo's
  // .git/logs/HEAD for prompt scans. Sandboxed to WATCHED_PROJECTS paths.
  cron.schedule(ARCHIVIST_CRON, async () => {
    try {
      await runArchivist({ trigger: 'cron' });
    } catch (e) {
      console.error(`[cron] archivist run failed: ${e.message}`);
    }
  });
  startWatchers();
  console.log(`Archivist cron registered: "${ARCHIVIST_CRON}" (every 30 min)`);

  // Morning brief: curate a personal news digest at dawn. Degrades to an empty
  // brief (with an explanatory note) when NEWS_API_KEY isn't set.
  cron.schedule(BRIEF_CRON, async () => {
    try {
      await runMorningBrief({ trigger: 'cron' });
    } catch (e) {
      console.error(`[cron] morning brief run failed: ${e.message}`);
    }
  });
  console.log(`Morning brief cron registered: "${BRIEF_CRON}" (06:00 daily)`);

  // Email agent: daily read-only Gmail triage. No-ops with a clear log line
  // until `npm run gmail:auth` has been run (credentials + token present).
  cron.schedule(EMAIL_CRON, async () => {
    try {
      await runEmailAgent({ trigger: 'cron' });
    } catch (e) {
      console.error(`[cron] email agent run failed: ${e.message}`);
    }
  });
  console.log(`Email agent cron registered: "${EMAIL_CRON}" (08:00 daily)`);
});
