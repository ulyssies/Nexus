// ============================================================
//  PROJECT ARCHIVIST — turns git history into second-brain memory.
//
//  For each WATCHED_PROJECTS repo:
//    1. read new commits via simple-git (those not yet recorded),
//    2. summarize each into { summary, why, impact } with Claude (Sonnet),
//    3. write a project_changes row + a graph note (via projectChangesRepo).
//
//  Triggers: a 30-min cron poll (the backbone) + a chokidar watch on each
//  repo's .git/logs/HEAD (appended on every commit) for a prompt, debounced
//  scan. Both call the same scanProject().
//
//  SANDBOX: filesystem reach is confined to the configured project paths —
//  simple-git is pointed only at those dirs and chokidar watches only their
//  .git/logs/HEAD. This confinement is why Nexus stays safe to run locally.
//
//  Degrades without a key: commits are still recorded, using the commit
//  message as the summary instead of an AI synthesis (no crash, no skip).
// ============================================================
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import chokidar from 'chokidar';
import { trackedCreate, startRun, finishRun } from './claudeClient.js';
import { WATCHED_PROJECTS } from '../config.js';
import { recordChange, hasCommit } from '../db/projectChangesRepo.js';

const MODEL = 'claude-sonnet-4-6'; // change synthesis — judgement, but routine → Sonnet
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // git's canonical empty tree (root-commit diffs)
const MAX_SCAN = 25; // most new commits to ingest per scan (avoids huge first-run backfills)

// diff stats for a commit; handles the root commit (no parent) via the empty tree.
async function commitStat(git, hash) {
  for (const base of [`${hash}^`, EMPTY_TREE]) {
    try {
      const s = await git.diffSummary([base, hash]);
      return {
        files: s.files.length,
        insertions: s.insertions,
        deletions: s.deletions,
        fileList: s.files.map((f) => f.file).slice(0, 25),
      };
    } catch { /* try next base */ }
  }
  return { files: 0, insertions: 0, deletions: 0, fileList: [] };
}

// Ask Claude to synthesize a commit into summary/why/impact. Falls back to the
// raw commit message (no key or error) so a change is never lost.
async function summarize(project, commit, stat, runId = null) {
  const subject = commit.message.split('\n')[0];
  const fallback = {
    summary: subject,
    why: commit.body?.trim() || null,
    impact: stat.files ? `${stat.files} files, +${stat.insertions}/-${stat.deletions}` : null,
  };
  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  try {
    const res = await trackedCreate({
      agent: 'archivist', runId,
      model: MODEL,
      max_tokens: 300,
      system: `You are a code archivist. Given a git commit, write a short, plain-English record of the change for the developer's personal memory. Respond with ONLY a JSON object: {"summary": "one sentence — what changed", "why": "the intent/reason, or null if not inferable", "impact": "the practical effect, or null"}. No markdown, no extra text. Be concrete and specific to this commit; do not invent details not supported by the message or files.`,
      messages: [{
        role: 'user',
        content: `Project: ${project.name} (${project.type})
Commit message: ${commit.message}
Files changed (${stat.files}): ${stat.fileList.join(', ') || '(none detected)'}
Lines: +${stat.insertions} / -${stat.deletions}`,
      }],
    });
    const raw = res.content[0].text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);
    return {
      summary: String(parsed.summary || subject).trim(),
      why: parsed.why ? String(parsed.why).trim() : fallback.why,
      impact: parsed.impact ? String(parsed.impact).trim() : fallback.impact,
    };
  } catch (e) {
    console.error(`  [WARN] archivist summarize failed (${project.name}): ${e.message}`);
    return fallback;
  }
}

/**
 * Scan one project for new commits and record them (oldest→newest so history
 * reads in order). Returns { project, recorded, skipped:boolean, reason? }.
 */
export async function scanProject(project, trigger = 'cron') {
  if (!existsSync(project.path) || !existsSync(join(project.path, '.git'))) {
    return { project: project.name, recorded: 0, skipped: true, reason: 'not a git repo / path missing' };
  }
  const git = simpleGit({ baseDir: project.path }); // sandboxed to this path
  if (!(await git.checkIsRepo())) {
    return { project: project.name, recorded: 0, skipped: true, reason: 'not a git repo' };
  }

  // newest-first; collect new commits until we hit one already recorded
  const log = await git.log({ maxCount: 100 });
  const fresh = [];
  for (const c of log.all) {
    if (hasCommit(project.name, c.hash)) break;
    fresh.push(c);
    if (fresh.length >= MAX_SCAN) break;
  }
  if (!fresh.length) return { project: project.name, recorded: 0 };

  const runId = startRun('archivist', trigger);
  try {
    let recorded = 0;
    for (const commit of fresh.reverse()) { // oldest first
      const stat = await commitStat(git, commit.hash);
      const { summary, why, impact } = await summarize(project, commit, stat, runId);
      const row = recordChange({
        project_name: project.name,
        project_path: project.path,
        change_type: 'commit',
        commit_hash: commit.hash,
        summary, why, impact,
        diff_stat: stat.files ? `${stat.files} files, +${stat.insertions}/-${stat.deletions}` : null,
        changed_at: commit.date,
      });
      // Commits are recorded to project_changes only (the Projects-tab changelog),
      // not mirrored into the second-brain graph — so no graph note to tag here.
      if (row) recorded += 1;
    }
    finishRun(runId, { status: 'ok', summary: `${project.name}: recorded ${recorded} change${recorded === 1 ? '' : 's'}` });
    return { project: project.name, recorded };
  } catch (e) {
    finishRun(runId, { status: 'error', error: e.message });
    throw e;
  }
}

/** Scan every watched project. Called by the cron and the manual route. */
export async function runArchivist({ trigger = 'cron' } = {}) {
  const results = [];
  for (const project of WATCHED_PROJECTS) {
    try {
      results.push(await scanProject(project, trigger));
    } catch (e) {
      console.error(`[archivist:${trigger}] ${project.name} scan failed: ${e.message}`);
      results.push({ project: project.name, recorded: 0, error: e.message });
    }
  }
  const total = results.reduce((n, r) => n + (r.recorded || 0), 0);
  if (total) console.log(`[archivist:${trigger}] recorded ${total} new change(s)`);
  return { results, total };
}

// ── chokidar: prompt scans on commit ─────────────────────────────────────────
// Watch each repo's .git/logs/HEAD (appended on every commit/checkout). A
// single-file watch is cheap and reliable, and keeps us inside the sandbox.
let watchers = [];
export function startWatchers() {
  stopWatchers();
  const debounce = new Map();
  for (const project of WATCHED_PROJECTS) {
    const head = join(project.path, '.git', 'logs', 'HEAD');
    if (!existsSync(head)) continue;
    const w = chokidar.watch(head, { ignoreInitial: true });
    w.on('change', () => {
      clearTimeout(debounce.get(project.name));
      // debounce: a commit can touch HEAD a couple times in quick succession
      debounce.set(project.name, setTimeout(() => {
        scanProject(project).catch((e) => console.error(`[archivist:watch] ${project.name}: ${e.message}`));
      }, 2000));
    });
    watchers.push(w);
  }
  if (watchers.length) console.log(`Archivist watching ${watchers.length} repo HEAD file(s)`);
  return watchers.length;
}

export function stopWatchers() {
  for (const w of watchers) w.close();
  watchers = [];
}
