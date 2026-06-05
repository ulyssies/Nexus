// Project archivist API — read the recorded change history + manual scan.
// Reads are pure local; POST /scan triggers the git-log poll (Claude
// summaries when a key is set, raw commit messages otherwise).
import { Router } from 'express';
import { listProjects, listChanges } from '../db/projectChangesRepo.js';
import { runArchivist } from '../agents/archivistAgent.js';
import { WATCHED_PROJECTS } from '../config.js';

const router = Router();

// GET /api/projects — one card per watched project with recorded history,
// merged with the configured list (so a not-yet-scanned repo still shows).
router.get('/', (_req, res) => {
  const recorded = new Map(listProjects().map((p) => [p.project_name, p]));
  const projects = WATCHED_PROJECTS.map((w) => {
    const r = recorded.get(w.name);
    return {
      name: w.name, path: w.path, type: w.type,
      change_count: r?.change_count || 0,
      last_changed_at: r?.last_changed_at || null,
    };
  });
  res.json({ projects });
});

// GET /api/projects/:name/changes — recent AI-summarized changes for a project.
router.get('/:name/changes', (req, res) => {
  res.json({ changes: listChanges(req.params.name, Math.min(Number(req.query.limit) || 30, 200)) });
});

// POST /api/projects/scan — run the archivist now over all watched repos.
router.post('/scan', async (_req, res) => {
  try {
    res.json(await runArchivist({ trigger: 'manual' }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
