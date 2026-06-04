# CLAUDE.md

This file is the source of truth for AI coding tools (Claude Code, Codex, etc.) in this project. Read it fully before acting. Sub-agents must read it before any scoped work.

> Tailored from `master.html` — the living design + planning spec for Nexus. `master.html` (its `:root` CSS variables and each `.view` block) is the design source of truth; this file is the architectural source of truth. When the two disagree on a value, `master.html` wins for design (colors/fonts/spacing) and this file wins for structure/stack.

---

## Project Overview

Nexus is a personal AI operating system: a local-first dashboard where specialized AI agents share a common context layer — your notes, goals, journal, and projects. The second brain isn't a feature; it's the nervous system the agents read from and write to. Each agent (jobs, email, council, accountability, morning brief, project archivist) does its own work but reads the same SQLite context, so they can act on each other's data.

It is **not** a deployed web app. It runs entirely on `localhost`, is never exposed publicly, and is distributed as a repo others clone and configure via the README. Filesystem and inbox access are exactly why it stays local-only.

**Status:** Phase 2 complete. The Vite+React frontend, Express server, and SQLite schema are scaffolded; `master.html` CSS is ported into `index.css`. The job-agent fetch/score pipeline is absorbed into `server/agents/jobAgent.js` (fetch from Adzuna/Jobicy/The Muse → score against résumés with Claude → write to the `jobs` table → optional email digest). It runs on a `node-cron` 3-day schedule registered on boot and via a manual "run now" button (`POST /api/jobs/run`). The Job board renders live from the DB. Nexus is self-contained — the external `~/Desktop/job-agent` repo is no longer a dependency.

**Phase 3 (journal + second brain) is done:** notes/tags backend (`db/notesRepo.js`, `routes/notes.js`), a Journal view, a force-graph Second-brain view (`react-force-graph-2d`; nodes = notes, edges = shared tags), and an AI auto-tagging agent (`agents/tagAgent.js`). Verified live: auto-tagging and the live job pipeline (scoped run) both work against real APIs.

**Phase 4 (Council of 5) is scaffolded and working:** `agents/councilAgent.js` runs 5 parallel persona calls → a challenge pass (each sees the others, declares stance via a `STANCE:` first line) → a Haiku consensus score, reads journal+goals as a cached shared-context prefix, and persists to `council_sessions`/`council_responses`. `routes/council.js` + `CouncilView.jsx` complete the loop (the view replays the latest session on load). **The five persona system prompts in `councilAgent.js` are deliberately thin placeholders — refine them in the owner's voice (Zeno most of all); everything else is final.** Keys live in `server/.env`.

---

## Stack

- **Frontend:** Vite + React 18, functional components + hooks, SPA served on `localhost:5173`. `master.html` is the design source — port its `:root` CSS variables verbatim into `index.css`, convert each `.view` block into a React component.
- **Backend + agent host:** Express, a single long-running Node process on `localhost:3001`. Hosts the REST API, all agents, all schedulers, and all file watchers. This is the piece that runs 24/7 — agents live here, never in the frontend.
- **Database:** SQLite via `better-sqlite3`, single file `nexus.db`. Zero setup, synchronous API, fast. This is the shared context layer every agent reads/writes. Migrate the existing `jobs.json` into a `jobs` table.
- **Auth:** none (local-only, single user). The email agent uses Google OAuth (`gmail.readonly` scope) only to read Gmail — not app auth.
- **Scheduling:** `node-cron`, in-process. All schedules register on Express boot (job agent every 3 days, email daily, accountability check-ins, morning brief at dawn).
- **AI:** `@anthropic-ai/sdk`, direct Anthropic API with your own key. Each agent = a system prompt + tool definitions. Use prompt caching for shared context (resume, notes, goals) to cut cost. **Model policy (cost-first):** default agent reasoning to **Sonnet 4.6** (`claude-sonnet-4-6`); use **Haiku 4.5** (`claude-haiku-4-5-20251001`) for cheap classification (job scoring, tagging, urgent-vs-noise). **Opus 4.8 is too expensive for routine agents — reserve it only where output quality clearly justifies the cost, and flag that as a deliberate choice.** Job scorer and tag agent already use Sonnet.
- **Graph:** `react-force-graph-2d` (fastest path) or raw D3 force for full control. Nodes = notes/journal entries, edges = shared AI tags.
- **Package manager:** npm.
- **Runtime target:** local-only. Two processes on one machine (Vite + Express). Never deployed; never bound to a public interface.

### Why this stack
- **Express over Next.js** because agents need a long-running process for cron + file watchers — Next API routes aren't built for that.
- **Two clean pieces (React frontend / Express backend)** maps onto the familiar Vercel+Render mental model, just both local. Sustainable, expandable, easy for Claude Code / Codex to reason about.
- **SQLite + better-sqlite3 over a server DB** because it's zero-setup, a single file, and synchronous — perfect for a single-user local app and a shared context layer.
- **Direct Anthropic SDK over a wrapper** so prompt caching is under our control to keep personal daily cost low (~$10–15/mo).

---

## Architecture

A single long-running Express process hosts every agent; the React SPA is a thin client that calls its REST API. Every agent reads and writes the **same `nexus.db`** — that shared context is the whole point. Design the schema so cross-agent reads/writes are trivial (e.g. the email agent updating `jobs.status`).

```
Gmail inbox   -> Email agent     -> SQLite -> updates Job agent statuses
Job boards    -> Job agent       -> match scoring -> 3-day email report
Notes + goals -> SQLite context  -> Council + Accountability read it
Code repos    -> Archivist watch -> SQLite + graph nodes
```

Non-obvious rules:
- The backend is **one** long-running Express process. Do not split agents into serverless functions — cron and watchers must persist.
- The frontend never touches the DB or external APIs directly; everything goes through Express.
- Cross-agent writes are the source of the system's power (e.g. an "interview" email flips a `jobs.status`). Schema must make these cheap.

### Agents (the build guide)

| Agent | Status | Trigger | Reads | Writes |
|---|---|---|---|---|
| **Job agent** | ✅ built · pipeline absorbed, cron + manual run wired | `node-cron 0 7 */3 * *` + manual "run now" button | `server/resumes/*.tex`, Adzuna/Muse/Jobicy APIs | `jobs` table, sends email report |
| **Email agent** | to build | `node-cron` daily + manual refresh | Gmail API (read-only), `jobs` for company matching | `email_flags`, `calendar_events`, updates `jobs.status` |
| **Council of 5** | ✅ scaffolded · persona prompts to refine | on-demand (user question) | recent journal entries, active goals | council responses + consensus score |
| **Accountability agent** | to build | `node-cron` check-ins (~8pm) + streak rollover | `goals`, `checkins`, `streaks` | check-in messages, streak updates |
| **Morning brief agent** | to build | `node-cron` early morning (~6am) | news API, tags/interests from `notes` | `morning_brief` (daily articles + summaries) |
| **Project archivist** | to build | poll `git log` every 30min (simple-git) + chokidar | watched code dirs (diffs) | `project_changes` table + graph nodes |

- **Job agent (done):** the pipeline lives in `server/agents/jobAgent.js` — fetch (Adzuna/Jobicy/The Muse via native `fetch`, no axios) → score in DA/SWE batches against `server/resumes/*.tex` with Claude (`claude-sonnet-4-6`, résumé prompt-cached) → write via `db/jobsRepo.js` → optional Nodemailer digest. Settings (cities, search terms, thresholds, schedule, résumé paths) are in `server/config.js`. Writes share one upsert with the migration so a re-fetch updates the same row and preserves any advanced `jobs.status`. `runJobAgent()` is called by the boot cron and by `POST /api/jobs/run`; the UI polls `GET /api/jobs/run/status`. Note: the original `parseResume`/`extractSkills` step is intentionally not wired in — the scorer consumes the full résumé directly (in the source it only logged a profile).
- **Email agent:** classifies importance, surfaces unread that matters, extracts deadlines into the calendar, and auto-updates job application statuses by matching companies. Sonnet 4.6 for urgent-vs-noise and status inference (Haiku for first-pass triage if volume warrants).
- **Council of 5 elders (scaffolded):** in `agents/councilAgent.js` — five personas answer in parallel (Sonnet), a 2nd pass lets each see the others and declare a stance, and a Haiku call scores consensus 0–100. Reads journal + goals (cached prefix). The mechanism is final; the persona prompt CONTENT is placeholder text for the owner to refine (Zeno is the hardest to do well).
- **Project archivist:** keep filesystem access **sandboxed to the explicit `WATCHED_PROJECTS` paths** — this is why the app stays local-only.

---

## Deployment / Run

Local-only — there is no deploy. "Run" means starting both dev processes.

- **How to install:** `npm install` in the frontend, and `npm install` in `server/` (separate `package.json` per piece).
- **How to run:** start the Express backend (`server/`, listens on `localhost:3001`) and the Vite dev server (frontend, `localhost:5173`). Backend must stay running for cron + watchers.
- **Environment:** all secrets live in `server/.env` (gitignored). Ship a `server/.env.example`. Never commit `.env` or `credentials.json`.
- **Ports/URLs:** frontend `http://localhost:5173`, backend API `http://localhost:3001`. Never bind to a public interface.

### Credentials (all in `server/.env`)
- `ANTHROPIC_API_KEY` — required, all agents. console.anthropic.com → API keys.
- `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` — required, job agent. developer.adzuna.com (free tier 250/day). Muse + Jobicy need no key.
- **Gmail OAuth** — required, email agent. Google Cloud → enable Gmail API → OAuth Desktop creds → `credentials.json`; first run authorizes in browser, token cached locally. Scope `gmail.readonly` (never send/delete).
- `EMAIL_USER` + `EMAIL_APP_PASSWORD` + `EMAIL_RECIPIENT` — required, job report email (Nodemailer; Gmail app password, needs 2FA).
- **News API key** — required, morning brief. newsapi.org free dev tier (or GNews/Currents).
- `WATCHED_PROJECTS` — required, archivist. Absolute local folder paths (`config.js`), e.g. `[{ name, path, type }]`. Not a credential; these are disk paths the watcher reads.

---

## Project Structure

Layout is a **single repo with `server/` nested**: the Vite + React frontend is the root package (`package.json`, `vite.config`, `src/` at repo root), and the Express backend is its own nested package (`server/package.json`). Two `package.json`s, one repo. Tree below reflects current reality; keep it current as files land.

```
nexus/                       # repo root = the Vite + React frontend (port 5173)
├── master.html              # design source of truth (brief view removed; Phase-1+ build doc lives in CLAUDE.md/README)
├── CLAUDE.md
├── README.md                # clone + configure + run guide (setup-facing)
├── package.json             # frontend deps
├── vite.config.js           # proxies /api -> localhost:3001 in dev
├── index.html
├── src/
│   ├── main.jsx             # React entry
│   ├── App.jsx              # shell + nav + view routing
│   ├── index.css            # CSS variables ported verbatim from master.html
│   ├── api.js               # thin fetch client -> Express /api (incl. runJob / jobRunStatus)
│   └── views/
│       ├── JobsView.jsx     # Job board, live from the DB + "run now" button & polling
│       ├── JournalView.jsx  # free-form journal: write + save (auto-tagged) + recent entries
│       ├── GraphView.jsx    # second brain: react-force-graph-2d, nodes=notes, edges=shared tags
│       ├── CouncilView.jsx  # Council of 5: ask box, elder cards + stances, consensus meter
│       └── Placeholder.jsx  # stand-in for not-yet-built views
└── server/                  # nested Express package — long-running agent host (port 3001)
    ├── package.json         # backend deps + scripts (migrate:jobs, purge:jobs)
    ├── .env.example         # .env itself is gitignored
    ├── index.js             # Express app + node-cron registration on boot
    ├── config.js            # agent settings: cities, search terms, thresholds, schedule, résumé paths
    ├── resumes/             # da_resume.tex / swe_resume.tex — what the scorer compares against
    ├── agents/
    │   ├── jobAgent.js      # absorbed fetch → score → save → email pipeline + run state
    │   ├── tagAgent.js      # auto-tags a note on save (Claude); graceful no-key fallback
    │   └── councilAgent.js  # Council of 5: parallel personas → challenge pass → consensus
    ├── db/
    │   ├── index.js         # better-sqlite3 connection; applies schema on open
    │   ├── schema.sql       # full shared-context schema (all planned tables)
    │   ├── jobsRepo.js      # shared jobs upsert + dedup helpers (agent + migration use it)
    │   ├── notesRepo.js     # notes/tags/note_tags CRUD + graph (nodes + shared-tag edges)
    │   ├── maintenance.js   # purgeStaleJobs() retention sweep (called by the cron)
    │   └── nexus.db         # the SQLite file (gitignored)
    ├── routes/
    │   ├── jobs.js          # job board API + POST /run, GET /run/status
    │   ├── notes.js         # notes CRUD + /graph + auto-tag on create + /:id/retag
    │   └── council.js       # POST /ask, GET /elders, GET /:id, GET / (history)
    └── scripts/
        ├── migrate-jobs.js  # one-time legacy jobs.json -> SQLite import (explicit path)
        └── purge-stale-jobs.js  # delete unapplied jobs >30d old

# Not yet created (later phases): server/config WATCHED_PROJECTS (archivist),
# Gmail credentials.json (email agent), more agents under server/agents/.
```

---

## Conventions

- **Naming:** camelCase JS vars/functions, PascalCase React components, snake_case for SQL tables/columns.
- **DB tables (all created in `server/db/schema.sql`):** `jobs`, `email_flags`, `calendar_events`, `goals`, `checkins`, `streaks`, `notes`, `tags`, `note_tags`, `morning_brief`, `morning_brief_items`, `project_changes`, `council_sessions`, `council_responses`. Only `jobs` holds real data so far.
- **Commits:** conventional commits (feat / fix / chore / docs) — confirm before relying on tooling that enforces it.
- **Branches:** confirm with the project owner (not yet established).
- **Error handling:** never swallow errors silently. Log with context — agents run unattended, so a silent failure is invisible.
- **Comments:** explain *why*, not *what*. Remove debug comments before commit.
- **Tests:** none yet — establish per layer when the first agent lands.

---

## Design System

- **Design source:** `./master.html` — its `:root` CSS variables and each `.view` block. This is the **single** source of truth for UI. Do not pull in any global/shared design file.
- **Fonts:** Syne (UI) + JetBrains Mono (mono). Accent is "elder purple" `#7c6fe0`; per-agent colors are defined as CSS variables (`--job`, `--email`, `--council`, `--acct`, `--news`, `--project`).
- **Theme:** dark-only. Do not add a light theme.
- **Rule:** read the design source before touching any styles. Port its tokens verbatim into `index.css`. Each `.view` maps to one React component; the static data shown is the target shape — replace it with API calls to Express. **Do not redesign.**

---

## Do Not Touch

- `.env` / `server/.env` — never read, never modify, never commit.
- `credentials.json` and the cached Gmail OAuth token — never commit, never log.
- `nexus.db` — don't hand-edit; go through the DB layer / migrations.
- The Gmail integration scope — stay `gmail.readonly`; the email agent never sends or deletes.
- The archivist's filesystem reach — keep it sandboxed to the `WATCHED_PROJECTS` paths.
- `master.html` design tokens — port them; don't alter the design source to fit code.

---

## Current Priorities

1. **Phase 1 — Scaffold + DB ✅ done:** Vite+React frontend, Express server, SQLite schema, `jobs.json` migration, `master.html` CSS → `index.css`, shell + nav + routing all in place.
2. **Phase 2 — Job agent ✅ done:** pipeline absorbed into `server/agents/jobAgent.js`, settings in `server/config.js`, 3-day `node-cron` registered on boot (also calls `purgeStaleJobs()`), manual "run now" button + status polling, Job board live from the DB, README written, brief view retired, external repo dependency removed.
3. **Phase 3 — Journal + second brain ✅ done:** notes/tags backend, Journal view (write + live auto-tag on save), force-graph Second-brain view, AI auto-tagging agent (reuses existing tags to keep the graph connected). Auto-tagging verified live. (Optional later: note edit/delete UI; archivist output as graph nodes.)
4. **Phase 4 — Council of 5 (scaffolded, working):** ✅ `councilAgent.js` (parallel personas → challenge pass → Haiku consensus, cached journal+goals context), ✅ `routes/council.js`, ✅ `CouncilView.jsx` (replays latest session). Personas default to Sonnet 4.6 (cost-first). ⬜ remaining: **refine the 5 persona system prompts in the owner's voice (esp. Zeno)** — they're placeholders. Then optional: persona-pick model overrides, session history UI.
   - **Future idea — elder facial expressions:** the owner has 5 elder portrait images (currently in `~/Downloads/ChatGPT Image Jun 4 ... (1–5).png`) and wants each elder's avatar to show an expression reflecting its stance after a consultation (e.g. challenges → stern, agrees → warm). Deferred: needs the images imported into the repo and mapped to elders + per-stance expressions. Import + map when building.
5. **Phase 5 — Email + accountability + brief:** Gmail integration, cross-agent status updates, goal tracking + check-ins, morning brief curation.
6. **Phase 6 — Project archivist:** git watcher, AI change summaries, graph integration. Then iterate toward real daily use.

---

## Known Issues

- All AI features need `ANTHROPIC_API_KEY` in `server/.env` (+ `ADZUNA_*` for live job fetch). Without a key, every agent degrades gracefully: `POST /api/jobs/run` → clear 400; notes save untagged; `POST /api/council/ask` → clear 400. Nothing crashes. The key is now present and **the job pipeline (scoped live run), auto-tagging, and the council have all been verified end-to-end against the real API.**
- A full job run is slow (Adzuna queried per city × title with throttling), so it runs in the background; the UI polls `GET /api/jobs/run/status`. The scoped verification used 1 city × 2 titles.
- The email digest was rebuilt against the Nexus `jobs` schema (status-based), not the external agent's separate `applications` table — simpler, but less detailed than the original report.
- **Council persona prompts in `agents/councilAgent.js` are placeholder starter text** — the pipeline runs, but the voices are generic until refined (Zeno especially). A council question costs ~11 calls (5+5 Sonnet + 1 Haiku consensus).
- Pass-2 stance is parsed from a `STANCE:` first line (not JSON) — robust against free-text quotes/braces, which an earlier JSON format broke on.

---

## Session Notes

Detailed session history lives in `.claude/session-notes.md`. Run `/session-end` at the end of each work session to append a dated entry and refresh Current Priorities above.

---

## Instructions for AI coding tools

- This file is authoritative for **architecture/stack**; `master.html` is authoritative for **design**. If something here conflicts with your default assumptions, **this file wins.**
- Copy the `master.html` `:root` CSS variables exactly — colors, fonts (Syne + JetBrains Mono), spacing. Don't redesign.
- Each `.view` block maps to one React component. Static data shown is the target shape — replace with API calls to Express.
- Keep the backend a **single long-running Express process** so cron + watchers persist. Never split agents into serverless functions.
- Every agent reads/writes the same SQLite — that shared context is the point. Design the schema so cross-agent reads/writes are trivial.
- Never introduce a framework, database, or dependency not listed in Stack without flagging it first. Planned npm packages: `express`, `better-sqlite3`, `node-cron`, `@anthropic-ai/sdk`, `nodemailer`, `googleapis`, `simple-git`, `chokidar`, `dotenv`, `cors` · frontend: `react`, `react-dom`, `react-force-graph-2d`, `d3`, `vite`.
- Keep the app local-only — filesystem and inbox access are why. Never bind to a public interface.
- Build incrementally. Prefer one working slice over several half-built ones. Follow the phase order above.
