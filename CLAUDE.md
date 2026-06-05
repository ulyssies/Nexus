# CLAUDE.md

This file is the source of truth for AI coding tools (Claude Code, Codex, etc.) in this project. Read it fully before acting. Sub-agents must read it before any scoped work.

> Tailored from `master.html` — the living design + planning spec for Nexus. `master.html` (its `:root` CSS variables and each `.view` block) is the design source of truth; this file is the architectural source of truth. When the two disagree on a value, `master.html` wins for design (colors/fonts/spacing) and this file wins for structure/stack.

---

## Project Overview

Nexus is a personal AI operating system: a local-first dashboard where specialized AI agents share a common context layer — your notes, goals, journal, and projects. The second brain isn't a feature; it's the nervous system the agents read from and write to. Each agent (jobs, email, council, accountability, morning brief, project archivist) does its own work but reads the same SQLite context, so they can act on each other's data.

It is **not** a deployed web app. It runs entirely on `localhost`, is never exposed publicly, and is distributed as a repo others clone and configure via the README. Filesystem and inbox access are exactly why it stays local-only.

**Status:** Phases 1–6 built and **live**, plus a home command center. All six agents (job, council, accountability, morning brief, email, project archivist) are implemented full-stack — repo layer → agent → routes → cron → API client → React view — and every cron registers on boot. **Both credential-gated agents are now authorized and verified live:** the email agent (Gmail `gmail.readonly` via `npm run gmail:auth`) triaged a real inbox, and the morning brief (real `NEWS_API_KEY`) curated real stories. The Vite+React frontend, Express server, and SQLite schema are scaffolded; `master.html` CSS is ported into `index.css`. The Home view is a cross-agent command center (`/api/overview`: stats + agent status + merged activity feed). The job-agent pipeline lives in `server/agents/jobAgent.js` (fetch Adzuna/Jobicy/The Muse → score vs. résumés with Claude → write `jobs` → optional email digest), on a 3-day cron + manual `POST /api/jobs/run`. Nexus is self-contained — the external `~/Desktop/job-agent` repo is no longer a dependency. Remaining work is iteration (tuning prompts, adding the owner's repos to `WATCHED_PROJECTS`).

**Phase 3 (journal + second brain) is done:** notes/tags backend (`db/notesRepo.js`, `routes/notes.js`), a Journal view, a force-graph Second-brain view (`react-force-graph-2d`; nodes = notes, edges = shared tags), and an AI auto-tagging agent (`agents/tagAgent.js`). Verified live: auto-tagging and the live job pipeline (scoped run) both work against real APIs.

**Phase 4 (Council of 5) is scaffolded and working:** `agents/councilAgent.js` runs 5 parallel persona calls → a challenge pass (each sees the others, declares stance via a `STANCE:` first line) → a Haiku consensus score, reads journal+goals as a cached shared-context prefix, and persists to `council_sessions`/`council_responses`. `routes/council.js` + `CouncilView.jsx` complete the loop (the view replays the latest session on load). **The five persona prompts are now a working v1** (in `councilAgent.js`): a shared `COUNCIL_CHARTER` holds the common loyalty + tone (all five are devoted to the owner's growth; read whether they're pressure-testing an idea vs. venting), and each `system` is one grounded lens — Marcus (control), Lyra (the long arc), Zeno (challenge/blind spots), Aria (emotional truth), Rex (concrete next step). Tune iteratively; the owner uses this to bounce ideas and to rant. Keys live in `server/.env`.

**Phase 5 (email + accountability + brief) is built:**
- **Accountability** (`agents/accountabilityAgent.js`, `db/goalsRepo.js`, `routes/accountability.js`, `GoalsView.jsx` + `AccountabilityView.jsx`): goals/checkins/streaks with a streak cache rebuilt from check-in history (`recomputeStreak` — a miss or gap resets the live count; `daily`/`weekly` cadence). A nightly `0 20 * * *` cron refreshes every streak and builds one streak-aware AI nudge (Sonnet; templated fallback with no key). Verified live end-to-end (streak math, CRUD, AI nudge `source:"ai"`).
- **Morning brief** (`agents/morningBriefAgent.js`, `db/briefRepo.js`, `routes/brief.js`, `HomeView.jsx`): learns interests from the second brain (top note tags + active goal categories) → NewsAPI fetch → Claude condense → one brief/day + ordered items, `0 6 * * *`. Graceful without `NEWS_API_KEY` (interests still learned; brief explains the gap). Verified: interest-learning + graceful degradation.
- **Email** (`agents/emailAgent.js`, `agents/gmailAuth.js`, `db/emailRepo.js`, `routes/email.js` + `routes/calendar.js`, surfaced in `CalendarView.jsx`): read-only Gmail (`gmail.readonly`, never send/delete) → batch-classify with Claude (importance/category/deadline/job-signal) → write `email_flags`, extract deadlines into `calendar_events`, and **flip `jobs.status` when an email reads like application movement** (the cross-agent write — `findJobByCompany` + `setJobStatus`). Coded graceful degradation: `NO_CREDENTIALS` / `NEEDS_AUTH` no-op with a clear status. One-time auth: `npm run gmail:auth`. Verified: boot, graceful skip, cross-agent job flip, calendar dedup. The live inbox fetch needs the owner's OAuth.

**Phase 6 (project archivist) is built:** `agents/archivistAgent.js`, `db/projectChangesRepo.js`, `routes/projects.js`, `ProjectsView.jsx`. Polls `git log` every 30 min (`*/30 * * * *`, simple-git) + a chokidar watch on each repo's `.git/logs/HEAD` for prompt scans → summarizes each new commit with Claude into `{summary, why, impact}` (raw commit message fallback with no key) → writes `project_changes` **and** a `kind='project'` graph note, then auto-tags that note so project work connects to journal themes in the second brain. Filesystem reach is sandboxed to `WATCHED_PROJECTS` (config.js; defaults to the Nexus repo). Verified live on the Nexus repo: 7 commits → tagged graph nodes → 21 graph links; re-scan dedups to 0.

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
| **Email agent** | ✅ built · Gmail read-only, cross-agent job flips, graceful pre-auth | `node-cron 0 8 * * *` + manual refresh | Gmail API (read-only), `jobs` for company matching | `email_flags`, `calendar_events`, updates `jobs.status` |
| **Council of 5** | ✅ working · personas v1 (tune iteratively) | on-demand (user question) | recent journal entries, active goals | council responses + consensus score |
| **Accountability agent** | ✅ built · streak math + AI nudge, verified live | `node-cron 0 20 * * *` + manual run | `goals`, `checkins`, `streaks` | check-in nudge, streak updates |
| **Morning brief agent** | ✅ built · interests from second brain, graceful w/o news key | `node-cron 0 6 * * *` + manual refresh | news API, tags/interests from `notes` + `goals` | `morning_brief` + items |
| **Project archivist** | ✅ built · git→summary→graph, verified on the Nexus repo | poll `git log` every 30min (simple-git) + chokidar HEAD watch | watched code dirs (commits) | `project_changes` + graph nodes |

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
│   ├── elderFaces.js        # council avatar sprites: stance -> facial expression
│   ├── assets/elders/       # cropped face tiles (neutral/agree/skeptical per elder)
│   └── views/
│       ├── HomeView.jsx     # command center: live stat cards + AGENTS status panel + cross-agent AGENT FEED + morning brief + goals snapshot (from /api/overview; takes onNavigate to jump to any tab)
│       ├── JobsView.jsx     # Job board, live from the DB + "run now" button & polling
│       ├── JournalView.jsx  # free-form journal: write + save (auto-tagged) + recent entries
│       ├── GraphView.jsx    # second brain: react-force-graph-2d, nodes=notes, edges=shared tags
│       ├── CouncilView.jsx  # Council of 5: ask box, elder cards + stances, consensus meter
│       ├── GoalsView.jsx    # goals list + add form + streak momentum bars
│       ├── AccountabilityView.jsx  # streak cards + today's check-in (done/partial/missed) + AI nudge
│       ├── CalendarView.jsx # upcoming events (user + email deadlines) + triaged inbox flags
│       ├── ProjectsView.jsx # archivist: per-repo cards + AI change log + "scan now"
│       └── Placeholder.jsx  # stand-in for any remaining not-yet-built view
└── server/                  # nested Express package — long-running agent host (port 3001)
    ├── package.json         # backend deps + scripts (migrate:jobs, purge:jobs, gmail:auth)
    ├── .env.example         # .env itself is gitignored
    ├── index.js             # Express app + node-cron registration for all 6 agents on boot
    ├── config.js            # agent settings: cities/terms/thresholds/résumés + all cron schedules + WATCHED_PROJECTS + Gmail/news config
    ├── resumes/             # da_resume.tex / swe_resume.tex — what the scorer compares against
    ├── credentials.json     # Gmail OAuth Desktop creds (gitignored; owner-supplied)
    ├── gmail-token.json     # cached read-only Gmail token (gitignored; from `npm run gmail:auth`)
    ├── agents/
    │   ├── jobAgent.js      # absorbed fetch → score → save → email pipeline + run state
    │   ├── tagAgent.js      # auto-tags a note on save (Claude); graceful no-key fallback
    │   ├── councilAgent.js  # Council of 5: parallel personas → challenge pass → consensus
    │   ├── accountabilityAgent.js  # nightly streak refresh + streak-aware AI nudge (templated fallback)
    │   ├── morningBriefAgent.js    # learn interests → NewsAPI → Claude condense → daily brief
    │   ├── emailAgent.js    # read-only Gmail → batch classify → flags + deadlines + jobs.status flip
    │   ├── gmailAuth.js     # OAuth client + coded NO_CREDENTIALS/NEEDS_AUTH for graceful degradation
    │   └── archivistAgent.js  # git log → Claude {summary,why,impact} → project_changes + tagged graph node; chokidar HEAD watch
    ├── db/
    │   ├── index.js         # better-sqlite3 connection; applies schema on open
    │   ├── schema.sql       # full shared-context schema (all tables)
    │   ├── jobsRepo.js      # shared jobs upsert + dedup helpers (agent + migration use it)
    │   ├── notesRepo.js     # notes/tags/note_tags CRUD + graph (nodes + shared-tag edges)
    │   ├── goalsRepo.js     # goals/checkins/streaks CRUD + recomputeStreak (cache from history)
    │   ├── briefRepo.js     # morning_brief + items; learnInterests() from tags + goals
    │   ├── emailRepo.js     # email_flags + calendar_events; findJobByCompany + setJobStatus (cross-agent bridge)
    │   ├── projectChangesRepo.js  # project_changes upsert + mirrors each change into a graph note
    │   ├── overviewRepo.js  # home dashboard: cross-agent stats + per-agent status + merged activity feed
    │   ├── maintenance.js   # purgeStaleJobs() retention sweep (called by the cron)
    │   └── nexus.db         # the SQLite file (gitignored)
    ├── routes/
    │   ├── jobs.js          # job board API + POST /run, GET /run/status
    │   ├── notes.js         # notes CRUD + /graph + auto-tag on create + /:id/retag
    │   ├── council.js       # POST /ask, GET /elders, GET /:id, GET / (history)
    │   ├── accountability.js  # goals CRUD + /goals/:id/checkin + /nudge + /run
    │   ├── brief.js         # GET / (today's digest + interests), POST /run
    │   ├── email.js         # /status, /stats, /flags, POST /run
    │   ├── calendar.js      # GET / (upcoming, user+email events), POST / (user event)
    │   └── overview.js      # GET / — one cross-agent snapshot for the home command center
    └── scripts/
        ├── migrate-jobs.js  # one-time legacy jobs.json -> SQLite import (explicit path)
        ├── purge-stale-jobs.js  # delete unapplied jobs >30d old
        └── gmail-auth.js    # one-time interactive Gmail authorization (paste-code flow)
```

---

## Conventions

- **Naming:** camelCase JS vars/functions, PascalCase React components, snake_case for SQL tables/columns.
- **DB tables (all created in `server/db/schema.sql`):** `jobs`, `email_flags`, `calendar_events`, `goals`, `checkins`, `streaks`, `notes`, `tags`, `note_tags`, `morning_brief`, `morning_brief_items`, `project_changes`, `council_sessions`, `council_responses`. All are now written by their agents (every table has an owner; `email_flags`/`calendar_events` populate once Gmail is authorized).
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
4. **Phase 4 — Council of 5 (working):** ✅ `councilAgent.js` (parallel personas → challenge pass → Haiku consensus, cached charter+journal+goals context), ✅ `routes/council.js`, ✅ `CouncilView.jsx` (replays latest session), ✅ **persona prompts v1** — diverse, grounded, all devoted to the owner; handles idea-bouncing and ranting. Sonnet 4.6 (cost-first). ⬜ iterate on voices as used; optional: session-history UI, elder facial expressions (see below).
   - ⬜ **Elder facial expressions — reverted (kept for later).** The council avatars now use the original **mono-letter** style (M/L/Z/A/R in per-elder tinted circles, stance-colored ring on the cards) — the generated face images felt out of place, so `CouncilView.jsx` no longer imports `elderFaces.js`. The face tiles (`src/assets/elders/<elder>-{neutral,agree,disagree}.png`) and `src/elderFaces.js` (`faceStyle`/`exprForStance`) are **retained on disk, unused**, for a possible later revival. To re-enable: re-import `faceStyle`/`exprForStance` in `CouncilView` and swap the `avatarOf(...)` letter avatars back to `faceStyle(...)`.
5. **Phase 5 — Email + accountability + brief ✅ built:** ✅ Accountability (`goalsRepo.js` + `accountabilityAgent.js` + `routes/accountability.js` + Goals/Accountability views; streak cache from check-in history; nightly nudge; verified live). ✅ Morning brief (`briefRepo.js` + `morningBriefAgent.js` + `routes/brief.js` + `HomeView.jsx`; interests learned from the second brain; graceful w/o `NEWS_API_KEY`). ✅ Email (`emailRepo.js` + `gmailAuth.js` + `emailAgent.js` + `routes/email.js`/`calendar.js` + `CalendarView.jsx`; read-only Gmail, deadline→calendar, cross-agent `jobs.status` flip; coded graceful degradation). ⬜ owner to run `npm run gmail:auth` and set a real `NEWS_API_KEY` to go fully live; ⬜ tune nudge/triage prompts as used.
6. **Phase 6 — Project archivist ✅ built:** `projectChangesRepo.js` + `archivistAgent.js` + `routes/projects.js` + `ProjectsView.jsx`. Git-log poll (30 min) + chokidar `.git/logs/HEAD` watch → Claude `{summary, why, impact}` → `project_changes` + auto-tagged `kind='project'` graph node. Sandboxed to `WATCHED_PROJECTS` (defaults to the Nexus repo). Verified live (7 commits → tagged nodes → 21 links; re-scan dedups). ⬜ owner adds their own repos to `WATCHED_PROJECTS`; optional `file_save` change_type later.
7. **Home command center ✅ built:** `db/overviewRepo.js` + `routes/overview.js` (`GET /api/overview`) aggregate, in one read, live stat cards + per-agent status lines + a merged cross-agent activity feed (jobs/email/council/checkins/project_changes/brief). `HomeView.jsx` renders it as the dashboard (AGENTS panel + AGENT FEED + brief + goals snapshot; `onNavigate` jumps to any tab). Verified live in-browser against the real DB; topbar now reads "6 agents active".
8. **Next — iterate toward daily use:** Gmail + NewsAPI are now live; tune the council/nudge/triage voices as used, add the owner's repos to `WATCHED_PROJECTS`, optional UIs (council history, note edit/delete, calendar month grid).

---

## Known Issues

- All AI features need `ANTHROPIC_API_KEY` in `server/.env` (+ `ADZUNA_*` for live job fetch). Without a key, every agent degrades gracefully: `POST /api/jobs/run` → clear 400; notes save untagged; `POST /api/council/ask` → clear 400. Nothing crashes. The key is now present and **the job pipeline (scoped live run), auto-tagging, and the council have all been verified end-to-end against the real API.**
- A full job run is slow (Adzuna queried per city × title with throttling), so it runs in the background; the UI polls `GET /api/jobs/run/status`. The scoped verification used 1 city × 2 titles.
- The email digest was rebuilt against the Nexus `jobs` schema (status-based), not the external agent's separate `applications` table — simpler, but less detailed than the original report.
- **Council persona prompts in `agents/councilAgent.js` are placeholder starter text** — the pipeline runs, but the voices are generic until refined (Zeno especially). A council question costs ~11 calls (5+5 Sonnet + 1 Haiku consensus).
- Pass-2 stance is parsed from a `STANCE:` first line (not JSON) — robust against free-text quotes/braces, which an earlier JSON format broke on.
- **Email agent is now authorized and live.** `server/credentials.json` + `server/gmail-token.json` (both gitignored) are present; a real inbox scan triaged 20 messages, extracted 1 deadline→calendar, and the cross-agent `jobs.status` flip path is verified. Scope is `gmail.readonly` — never sends/deletes. If the token is ever missing it degrades with a coded status (`NO_CREDENTIALS`/`NEEDS_AUTH`); re-run `npm run gmail:auth`. Minor tuning opportunity: marketplace "special offer" promos can over-classify as `urgent` — adjust the triage prompt in `emailAgent.js` if it annoys.
- **Morning brief is now live.** A real `NEWS_API_KEY` is set; a run curated 6 real stories (Claude-condensed, topic-mapped to interests learned from the journal). Still degrades gracefully if the key is removed. (Historical gotcha: a `KEY= # comment` line parses as empty in dotenv — keep values free of inline comments.)
- Verified live this session against the real Anthropic API: accountability streaks + AI nudge (`source:"ai"`), archivist git→summary→tagged graph nodes on the Nexus repo, morning-brief curation (6 stories), email triage (20 messages), and the home `/api/overview` aggregation. All 9 views render in-browser with no console/page errors. Each cost real Sonnet/Haiku calls.
- Archivist v1 records **commits only** (the chokidar watch on `.git/logs/HEAD` just triggers a prompt git scan); `file_save` change_type is defined in the schema but not yet emitted.

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
