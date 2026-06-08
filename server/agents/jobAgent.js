// ============================================================
//  JOB AGENT — absorbed from the external job-agent repo.
//
//  Pipeline (was main.js's 5 steps): fetch live listings from Adzuna +
//  Jobicy + The Muse, score each against the matching résumé with Claude,
//  upsert the scored rows into the shared `jobs` table, and (if email
//  creds exist) send a digest. Writes go through db/jobsRepo so the live
//  agent and the one-time migration share identical upsert semantics.
//
//  Two entry points call runJobAgent(): the node-cron schedule registered
//  on server boot, and the manual "run now" button via POST /api/jobs/run.
//  A module-level run state guards against overlapping runs and lets the
//  UI poll progress.
//
//  Uses the global fetch (Node 18+) — no axios — to stay within the
//  declared dependency set.
// ============================================================
import fs from 'node:fs';
import { trackedCreate, startRun, finishRun } from './claudeClient.js';
import nodemailer from 'nodemailer';
import {
  TARGET_CITIES, JOB_TITLES, EXCLUDED_KEYWORDS, MAX_JOB_AGE_DAYS,
  MIN_MATCH_PERCENT, SCORE_BATCH_SIZE, SCORING_MODEL, RESUME_PATHS, getJobTrack,
} from '../config.js';
import { makeJobId, normSource, getSeenJobKeys, upsertJobs } from '../db/jobsRepo.js';
import db from '../db/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function plainText(value = '') {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function jobDescription(value, max = 4000) {
  const text = plainText(value);
  return text.length > max ? text.slice(0, max).trim() : text;
}

// ── tiny fetch-JSON helper with timeout (replaces axios) ──────────────────
async function getJson(url, params = {}, timeoutMs = 10000) {
  const qs = new URLSearchParams(params).toString();
  const full = qs ? `${url}?${qs}` : url;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(full, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── source fetchers (ported from src/jobSearch.js) ────────────────────────
async function fetchJobicy(title) {
  try {
    const data = await getJson('https://jobicy.com/api/v2/remote-jobs', { count: 20, tag: title });
    return (data.jobs || []).map((j) => ({
      source: 'Jobicy',
      title: j.jobTitle || 'Unknown Title',
      company: j.companyName || 'Unknown Company',
      location: j.jobGeo || 'Remote',
      description: jobDescription(j.jobDescription || j.jobExcerpt),
      applyLink: j.url || '#',
      postedAt: j.pubDate || null,
      salary: null,
    }));
  } catch (e) {
    console.error(`  [WARN] Jobicy error [${title}]: ${e.message}`);
    return [];
  }
}

async function fetchAdzuna(title, city, region = 'us') {
  if (!process.env.ADZUNA_APP_ID || !process.env.ADZUNA_APP_KEY) return [];
  try {
    const params = {
      app_id: process.env.ADZUNA_APP_ID,
      app_key: process.env.ADZUNA_APP_KEY,
      what: title,
      results_per_page: 10,
      'content-type': 'application/json',
    };
    if (city !== 'Remote') params.where = city;
    const data = await getJson(`https://api.adzuna.com/v1/api/jobs/${region}/search/1`, params);
    return (data.results || []).map((j) => {
      const min = j.salary_min, max = j.salary_max;
      let salary = null;
      if (min != null && max != null) salary = `$${Number(min).toLocaleString()} - $${Number(max).toLocaleString()}`;
      else if (min != null) salary = `$${Number(min).toLocaleString()}+`;
      else if (max != null) salary = `$${Number(max).toLocaleString()}+`;
      return {
        source: 'Adzuna',
        title: j.title || 'Unknown Title',
        company: j.company?.display_name || 'Unknown Company',
        location: j.location?.display_name || 'Unknown',
        description: jobDescription(j.description),
        applyLink: j.redirect_url || '#',
        postedAt: j.created || null,
        salary,
      };
    });
  } catch (e) {
    console.error(`  [WARN] Adzuna error [${title} / ${city}]: ${e.message}`);
    return [];
  }
}

async function fetchTheMuse(title) {
  try {
    const data = await getJson('https://www.themuse.com/api/public/jobs', { page: 0, descending: true, level: 'Entry Level' });
    const first = title.toLowerCase().split(' ')[0];
    return (data.results || [])
      .filter((j) => j.name?.toLowerCase().includes(first))
      .slice(0, 8)
      .map((j) => ({
        source: 'The Muse',
        title: j.name || 'Unknown Title',
        company: j.company?.name || 'Unknown Company',
        location: j.locations?.map((l) => l.name).join(', ') || 'Remote',
        description: jobDescription(j.contents),
        applyLink: j.refs?.landing_page || '#',
        postedAt: j.publication_date || null,
        salary: null,
      }));
  } catch (e) {
    console.error(`  [WARN] The Muse error [${title}]: ${e.message}`);
    return [];
  }
}

const dedupKey = (j) => `${j.title}-${j.company}`.toLowerCase().replace(/\s+/g, '');

/** Step 2 — fetch from all sources, dedup, and filter (seen / senior / age). */
export async function fetchAllJobs({ cities = TARGET_CITIES, titles = JOB_TITLES, log = () => {} } = {}) {
  const seenJobs = getSeenJobKeys();
  const allJobs = [];
  const seen = new Set();
  const addJobs = (jobs, targetCity) => {
    for (const job of jobs) {
      const key = dedupKey(job);
      if (!seen.has(key)) { seen.add(key); allJobs.push({ ...job, targetCity }); }
    }
  };

  for (const { city, adzunaRegion } of cities) {
    for (const title of titles) {
      log(`fetching ${title} · ${city}`);
      addJobs(await fetchAdzuna(title, city, adzunaRegion), city);
      await sleep(500);
    }
  }
  for (const title of titles) { addJobs(await fetchJobicy(title), 'Remote'); await sleep(300); }
  for (const title of titles) { addJobs(await fetchTheMuse(title), 'Various'); await sleep(300); }

  const fresh = allJobs.filter((j) => !seenJobs.has(dedupKey(j)));
  const titleHasExcluded = (j) =>
    EXCLUDED_KEYWORDS.some((kw) => j.title.toLowerCase().includes(kw.toLowerCase()));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_JOB_AGE_DAYS);
  return fresh
    .filter((j) => !titleHasExcluded(j))
    .filter((j) => !j.postedAt || new Date(j.postedAt) >= cutoff);
}

// ── scoring (ported from src/scoreJobs.js) ────────────────────────────────
const SCORING_INSTRUCTIONS = `The candidate has approximately 1 year of total professional experience. Score each job on TWO dimensions combined into matchPercent:
  1. Skill alignment — how well the resume's skills, tools, and domain match the job requirements
  2. Seniority fit — whether the role's experience requirements are realistic for ~1 YOE

matchPercent must reflect BOTH. A strong skill match at an unrealistic seniority level (e.g. "3+ years required", "mid-level", "experienced") should score 60-72%, not 85%+. Only roles that are genuinely entry-level AND a good skill match should reach 85%+.

For each job return ONLY a valid JSON array. No markdown, no explanation. Each object must have:
- "index": number (0-based index within this batch)
- "roleSummary": 1-2 sentences describing the actual role and its purpose. Do not copy the company intro or opening boilerplate from the listing.
- "responsibilities": array of 3-5 concrete responsibilities/duties the person would perform in this role. Infer from the job description when the listing is verbose or boilerplate-heavy.
- "matchPercent": number 0-100 — combined skill + seniority fit as described above
- "matchCategory": one of "Excellent" (85-100), "Strong" (70-84), "Good" (55-69), "Fair" (40-54), "Low" (below 40)
- "alignedStrengths": array of 2-4 concrete candidate strengths from the resume that align with this role
- "positives": array of 2-4 role positives/opportunities for this candidate
- "negatives": array of 2-4 role negatives/risks/red flags for this candidate, including seniority or domain concerns
- "missingSkills": array of 2-3 skill strings the candidate lacks
- "reason": single sentence explaining the match, noting any seniority gap if present
- "estimatedSalary": string (e.g. "$85,000 - $110,000"), or the real salary from the listing when provided. If listing salary exists, use that exact value.
- "entryLevelFit": boolean — true only if this role is realistically attainable for a candidate with ~1 year of total experience, based on the job description's explicit years-of-experience requirements and seniority signals

JSON array:`;

async function scoreGroup(jobs, originalIndices, resume, label, log, runId) {
  const allScores = [];
  for (let i = 0; i < jobs.length; i += SCORE_BATCH_SIZE) {
    const batch = jobs.slice(i, i + SCORE_BATCH_SIZE);
    const batchIndices = originalIndices.slice(i, i + SCORE_BATCH_SIZE);
    const batchNum = Math.floor(i / SCORE_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(jobs.length / SCORE_BATCH_SIZE);
    log(`scoring ${label} batch ${batchNum}/${totalBatches}`);

    const jobList = batch
      .map((j, idx) =>
        `JOB ${idx}:\nTitle: ${j.title}\nCompany: ${j.company}\nLocation: ${j.location}\nDescription: ${j.description}` +
        (j.salary ? `\nSalary (from listing): ${j.salary}` : ''))
      .join('\n\n---\n\n');

    try {
      const response = await trackedCreate({
        agent: 'job', runId,
        model: SCORING_MODEL,
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: [
            // Résumé is the shared, reused prefix — cache it to cut cost across batches.
            { type: 'text', text: `You are a career coach. Compare this resume against each job listing and score the fit.\n\nRESUME:\n${resume}`, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: `JOBS TO EVALUATE:\n${jobList}\n\n${SCORING_INSTRUCTIONS}` },
          ],
        }],
      });
      const text = response.content[0].text.replace(/```json|```/g, '').trim();
      JSON.parse(text).forEach((s) => allScores.push({ ...s, globalIndex: batchIndices[s.index] }));
    } catch (e) {
      console.error(`  [WARN] Scoring error on [${label}] batch ${batchNum}: ${e.message}`);
    }
    if (i + SCORE_BATCH_SIZE < jobs.length) await sleep(300);
  }
  return allScores;
}

/** Step 3 — split DA/SWE, score each batch against its résumé. */
export async function scoreJobs(jobs, { log = () => {}, runId = null } = {}) {
  const daResume = fs.readFileSync(RESUME_PATHS.da, 'utf-8');
  const sweResume = fs.readFileSync(RESUME_PATHS.swe, 'utf-8');

  const da = { jobs: [], indices: [] };
  const swe = { jobs: [], indices: [] };
  jobs.forEach((job, i) => {
    const g = getJobTrack(job.title) === 'da' ? da : swe;
    g.jobs.push(job); g.indices.push(i);
  });

  const daScores = da.jobs.length ? await scoreGroup(da.jobs, da.indices, daResume, 'DA', log, runId) : [];
  const sweScores = swe.jobs.length ? await scoreGroup(swe.jobs, swe.indices, sweResume, 'SWE', log, runId) : [];
  return [...daScores, ...sweScores];
}

// ── save (Step 4) — into the shared jobs table via jobsRepo ───────────────
export function saveScoredJobs(scored) {
  const records = scored.map(({ score, job }) => ({
    external_id: makeJobId(job),
    source: normSource(job.source),
    track: job.track || getJobTrack(job.title),
    title: job.title || '(untitled)',
    company: job.company || '(unknown)',
    location: job.location || null,
    target_city: job.targetCity || null,
    url: job.applyLink || null,
    description: job.description || null,
    salary: score.estimatedSalary || job.salary || null,
    posted_at: job.postedAt || null,
    match_score: typeof score.matchPercent === 'number' ? score.matchPercent : null,
    match_category: score.matchCategory || null,
    match_reasons: JSON.stringify({
      reason: score.reason || null,
      roleSummary: score.roleSummary || null,
      responsibilities: Array.isArray(score.responsibilities) ? score.responsibilities : [],
      alignedStrengths: Array.isArray(score.alignedStrengths) ? score.alignedStrengths : [],
      positives: Array.isArray(score.positives) ? score.positives : [],
      negatives: Array.isArray(score.negatives) ? score.negatives : [],
      missingSkills: Array.isArray(score.missingSkills) ? score.missingSkills : [],
    }),
    entry_level_fit: score.entryLevelFit === true ? 1 : 0,
    status: 'new',
    status_updated_at: null,
    status_updated_by: null,
  }));
  return upsertJobs(records);
}

// ── email digest (Step 5) — adapted from src/emailSummary.js ──────────────
async function sendEmailReport(matched) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD || !process.env.EMAIL_RECIPIENT) {
    console.log('  [WARN] Email creds not set — skipping digest.');
    return false;
  }
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const color = (p) => (p >= 85 ? '#4ecba8' : p >= 70 ? '#6ea8fe' : p >= 55 ? '#f0a050' : '#f97316');
  const rows = [...matched].sort((a, b) => b.matchPercent - a.matchPercent).slice(0, 25).map((r) => `
    <tr>
      <td style="padding:8px 12px;font-weight:700;color:${color(r.matchPercent)}">${r.matchPercent}%</td>
      <td style="padding:8px 12px"><a href="${esc(r.applyLink)}" style="color:#7c6fe0;text-decoration:none;font-weight:600">${esc(r.title)}</a>
        <div style="font-size:11px;color:#64748b">${esc(r.company)} · ${esc(r.location)} · ${esc(r.source)}${r.entryLevelFit ? ' · <span style="color:#4ecba8">Entry</span>' : ''}</div></td>
      <td style="padding:8px 12px;color:#94a3b8;font-size:12px">${esc(r.reason)}</td>
    </tr>`).join('');
  const entryFit = matched.filter((r) => r.entryLevelFit).length;
  const date = new Date().toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD },
  });
  await transporter.sendMail({
    from: `Nexus Job Agent <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_RECIPIENT,
    subject: `Nexus Job Report — ${date} | ${entryFit} entry fit | ${matched.length} matches`,
    html: `<div style="background:#0d0d12;padding:28px;font-family:system-ui;color:#e8e8ef;max-width:860px;margin:0 auto">
      <h1 style="color:#7c6fe0;margin:0 0 4px;font-size:20px">Nexus Job Report</h1>
      <p style="color:#64748b;margin:0 0 20px;font-size:13px">${date} · ${matched.length} matches · ${entryFit} entry-level fit</p>
      <table width="100%" style="border-collapse:collapse;background:#15151c;border-radius:8px;overflow:hidden">${rows}</table>
    </div>`,
  });
  console.log(`  [OK] Digest sent -> ${process.env.EMAIL_RECIPIENT}`);
  return true;
}

// ── run-state (guards overlap; the UI polls this) ─────────────────────────
let state = { running: false, step: null, startedAt: null, finishedAt: null, summary: null, error: null, trigger: null };
export function getRunState() { return { ...state }; }

/**
 * Run the full pipeline. `trigger` is 'cron' | 'manual' for logging.
 * Pass { cities, titles } to scope a run (used for cheap test runs);
 * defaults to the full config.
 */
export async function runJobAgent({ trigger = 'manual', cities, titles, skipEmail = false } = {}) {
  if (state.running) {
    const e = new Error('Job agent is already running');
    e.code = 'ALREADY_RUNNING';
    throw e;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY is not set in server/.env — cannot score jobs.');
    e.code = 'NO_API_KEY';
    throw e;
  }

  const log = (step) => { state.step = step; console.log(`  · ${step}`); };
  state = { running: true, step: 'starting', startedAt: new Date().toISOString(), finishedAt: null, summary: null, error: null, trigger };
  const t0 = Date.now();
  console.log(`\n[job-agent] run start (${trigger})`);
  const runId = startRun('job', trigger);

  try {
    log('fetching listings');
    const jobs = await fetchAllJobs({ cities, titles, log });
    console.log(`  [OK] ${jobs.length} new listings`);

    let written = 0;
    let matched = [];
    if (jobs.length) {
      log('scoring matches');
      const scores = await scoreJobs(jobs, { log, runId });
      const scored = scores.map((s) => ({ score: s, job: jobs[s.globalIndex] })).filter((r) => r.job);

      log('saving to database');
      written = saveScoredJobs(scored);

      matched = scored
        .filter((r) => typeof r.score.matchPercent === 'number' && r.score.matchPercent >= MIN_MATCH_PERCENT)
        .map((r) => ({ ...r.score, ...r.job }));

      if (!skipEmail) { log('sending digest'); await sendEmailReport(matched); }
    }

    const totalInDb = db.prepare('SELECT COUNT(*) n FROM jobs').get().n;
    const summary = {
      scanned: jobs.length,
      written,
      matches: matched.length,
      entryFit: matched.filter((m) => m.entryLevelFit).length,
      excellent: matched.filter((m) => m.matchPercent >= 85).length,
      totalInDb,
      elapsedSec: Number(((Date.now() - t0) / 1000).toFixed(1)),
    };
    state = { running: false, step: 'done', startedAt: state.startedAt, finishedAt: new Date().toISOString(), summary, error: null, trigger };
    console.log(`[job-agent] done in ${summary.elapsedSec}s — ${summary.written} written, ${summary.matches} matches`);
    finishRun(runId, { status: 'ok', summary: `${summary.written} written · ${summary.matches} matches · ${summary.scanned} scanned` });
    return summary;
  } catch (err) {
    console.error(`[job-agent] FAILED (${trigger}): ${err.message}`);
    finishRun(runId, { status: 'error', error: err.message });
    state = { running: false, step: 'error', startedAt: state.startedAt, finishedAt: new Date().toISOString(), summary: null, error: err.message, trigger };
    throw err;
  }
}
