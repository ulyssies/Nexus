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
import { DB_PATH } from './db/index.js';
import { runJobAgent } from './agents/jobAgent.js';
import { purgeStaleJobs } from './db/maintenance.js';
import { JOB_AGENT_CRON } from './config.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors()); // local-only; the Vite dev server (5173) calls this
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true, db: DB_PATH }));
app.use('/api/jobs', jobsRouter);
app.use('/api/notes', notesRouter);
app.use('/api/council', councilRouter);

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
});
