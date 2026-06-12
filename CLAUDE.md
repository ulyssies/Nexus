# CLAUDE.md

This file is the source of truth for AI coding tools (Claude Code, Codex, etc.) in this project. Read it fully before acting. Sub-agents must read it before any scoped work.

> Tailored from `master.html` — the living design spec for Nexus. `master.html` (its `:root` CSS variables and each `.view` block) is the design source of truth; this file is the architectural source of truth. When the two disagree on a value, `master.html` wins for design (colors/fonts/spacing) and this file wins for structure/stack.

---

## Project Overview

Nexus is a personal AI operating system: a local-first dashboard where specialized AI agents share a common context layer — your notes, goals, journal, and projects. The second brain isn't a feature; it's the nervous system the agents read from and write to. Each agent does its own work but reads/writes the same SQLite database (`nexus.db`), so they act on each other's data.

It is **not** a deployed web app. It runs entirely on `localhost`, is never exposed publicly, and is distributed as a repo others clone and configure via the README. Filesystem and inbox access are exactly why it stays local-only.

**Status:** Phases 1–9 built and live. All agents are implemented full-stack (repo → agent → routes → cron/manual → API client → React view) and route every Claude call through one instrumented client. The credential-gated agents (Gmail read-only, NewsAPI) are authorized and verified against real data. Remaining work is iteration and the items in **Current Priorities**.

---

## Current state per area (the source of truth for what's actually built)

- **Job agent** — fetch (Adzuna/Jobicy/The Muse) → **lean** Claude scoring → write `jobs`. Scoring returns only `matchPercent`, `matchCategory`, `missingSkills`, a 1–2 sentence fit `reason`, `estimatedSalary`, `entryLevelFit` (`max_tokens: 2500`, résumé prompt-cached). **Automation is OFF** — gated by `JOB_AGENT_CRON_ENABLED = false` in `config.js`; the agent runs only via the **run now** button (`POST /api/jobs/run`). Both the daily cron and the boot catch-up are behind that flag. A run reports `phase` + monotonic `pct` (0–100) for a compact progress bar. Boot reconciliation closes orphaned `running` agent_runs.
  - **Board (`JobsView.jsx`)** — three subtabs: **Found by agent** (scored listings; "newest" = posted date; a **new-this-scan** badge; a **♥ heart** by each company toggles the role's `interested` status; a **★ Shortlist** filter shows interested roles), **Live applications** (applied / interviewing / offer), **Inactive applications** (rejected / withdrawn / archived + **ghosted** — `applied` with no reply in 30 days, *derived* in the UI, not a stored status). Company folders only appear when **sort = company**. Detail panel shows the listing's own description + the fit reason + missing skills (no generated role summaries).
  - **Settings → Job agent** — edit search **locations**, **search terms** (DA/SWE), and the two **résumés** (replace file or edit text) from the UI. Backed by an `app_settings` overrides table + `db/settingsRepo.js` + `routes/settings.js`. The agent reads effective settings (override ?? config default).
- **Email agent** (read-only Gmail, `gmail.readonly` — never sends/deletes) — `*/15 * * * *` + manual. Batch-classifies importance/category/deadline/job-signal/role with Claude, writes `email_flags`, extracts **real** deadlines into `calendar_events` (promo/noise "offer expires" emails are *not* treated as deadlines and never hit the calendar; a follow-up email that **reschedules** an event — e.g. an interview moved Mon→Wed — *moves* the existing event via its `event_key` instead of duplicating it, and voids the old email's stale deadline), flips `jobs.status` on application movement, **and creates a `source='email'` application row when the company isn't already tracked** (e.g. you applied on LinkedIn). Graceful `NO_CREDENTIALS` / `NEEDS_AUTH`. One-time `npm run gmail:auth`.
- **Council of 5** — five personas (Marcus/Lyra/Zeno/Aria/Rex) answer in parallel → challenge pass (stance via `STANCE:` first line) → Haiku consensus 0–100. Reads journal + goals as cached context. On-demand.
- **Accountability** — `0 20 * * *` + manual. Streaks rebuilt from check-in history; nightly streak-aware nudge (Sonnet; templated fallback). Merged into `GoalsView.jsx`.
- **Morning brief** — `0 6,12,18 * * *` + manual. **Topic-driven**: news topics are the user's **Settings news tags** (`brief_interests`), each expanded into a strong NewsAPI query via `QUERY_EXPANSIONS` (falls back to `FALLBACK_TOPICS` if none active). Fetches the **real article body** from each page and condenses with depth (teaches unfamiliar topics; labels always match the story). `buildDigest()` caches a home digest on `morning_brief.digest`/`digest_at`. Needs `NEWS_API_KEY`; degrades gracefully.
- **Project archivist** — `*/10 * * * *` (+ chokidar `.git/logs/HEAD` watch). Summarizes each commit with Claude into `project_changes` (the Projects-tab changelog) — `{summary, why, impact}`. **Commits are NOT mirrored into the second-brain graph** (and not auto-tagged): routine commits aren't knowledge worth revisiting, and they used to flood the graph. Sandboxed to `WATCHED_PROJECTS`.
- **Tagging agent** — auto-tags every new *note* (journal/research) on save, reusing existing tags so the graph stays connected. (No longer runs on archivist commits.)
- **Research agent** — chat sessions (paste/`fetchUrl`/Q&A) → **save** distills the whole conversation into one structured second-brain node (summary, key-concept tags, conclusions, tracked open questions, sources). **Unsaved sessions can be deleted** (`DELETE /api/research/sessions/:id`; saved ones are protected, 409). "File under" a concept on save.
- **Second brain (`GraphView.jsx`)** — nodes = notes worth revisiting only. `getGraph()` (`isGraphWorthy`) **excludes** archivist/commit nodes and notes with a body under `GRAPH_MIN_BODY` (60 chars); concepts always qualify. Tag edges (undirected, dashed) + directed parent→child hierarchy edges (solid, arrows). Forces tuned for a clean constellation (charge ~-360 / distanceMax 750, loose tag links). Node labels on hover only.
- **Calendar & email (`CalendarView.jsx`)** — three resizable panels: month grid (+ an **upcoming** list shown only when the selected day has no events of its own; events expand to show description/snippet + Gmail deep-link) · paginated/filterable inbox (each email expands to a decoded snippet + Gmail link) · **agent rail** of individual, timestamped, expandable insight cards that deep-link to the source email in Gmail, with a **last-scan** line.
- **Home (`HomeView.jsx`, `GET /api/home`)** — 5-zone command center: alert strip · today's agenda (one-click check-in + MiniCalendar) · brief digest · agent feed · agent-health row.
- **Observability** — every agent run + Claude call instrumented via `agents/claudeClient.js` (`agent_runs` / `agent_usage`); `GET /api/observability` + `SettingsView.jsx` show run history, errors, next run (cron-parser), and estimated cost per agent/day.

---

## Stack

- **Frontend:** Vite + React 18, functional components + hooks, SPA on `localhost:5173`. `master.html` is the design source — port its `:root` CSS variables verbatim into `index.css`; each `.view` block maps to one React component.
- **Backend + agent host:** Express, a single long-running Node process on `localhost:3001`. Hosts the REST API, all agents, all schedulers, and all file watchers. This runs 24/7 — agents live here, never in the frontend.
- **Database:** SQLite via `better-sqlite3`, single file `server/db/nexus.db`. The shared context layer every agent reads/writes.
- **Auth:** none (local-only, single user). The email agent uses Google OAuth (`gmail.readonly`) only to read Gmail — not app auth.
- **Scheduling:** `node-cron`, in-process; all schedules register on Express boot.
- **AI:** `@anthropic-ai/sdk`, direct Anthropic API. Use prompt caching for shared context (résumé, notes, goals). **Model policy (cost-first):** default reasoning to **Sonnet 4.6** (`claude-sonnet-4-6`); **Haiku 4.5** (`claude-haiku-4-5-20251001`) for cheap classification/consensus; **Opus is reserved** — only where quality clearly justifies the cost, flagged as deliberate.
- **Graph:** `react-force-graph-2d`. Nodes = notes, edges = shared AI tags + directed concept hierarchy.
- **Package manager:** npm. **Runtime target:** local-only, two processes on one machine. Never deployed.

### Why this stack
- **Express over Next.js** — agents need a long-running process for cron + file watchers.
- **SQLite + better-sqlite3** — zero-setup, single file, synchronous; perfect for a single-user local app and a shared context layer.
- **Direct Anthropic SDK** — prompt caching under our control to keep daily cost low (~$10–15/mo).

---

## Architecture

A single long-running Express process hosts every agent; the React SPA is a thin client over its REST API. Every agent reads/writes the **same `nexus.db`** — that shared context is the whole point.

```
Gmail inbox   -> Email agent     -> SQLite -> updates/creates job applications
Job boards    -> Job agent       -> match scoring -> board + tracker
Notes + goals -> SQLite context  -> Council + Accountability + Brief read it
Code repos    -> Archivist watch -> project_changes (Projects-tab changelog)
```

Non-obvious rules:
- The backend is **one** long-running Express process. Never split agents into serverless functions — cron and watchers must persist.
- The frontend never touches the DB or external APIs directly; everything goes through Express.
- Cross-agent writes are the source of the system's power (an "interview" email flips a `jobs.status`; a confirmation email *creates* a tracked application). Schema makes these cheap.
- Commits live in the **Projects changelog**, not the knowledge graph. The graph is curated to notes worth revisiting.

### Cron schedules (all in `server/config.js`, registered on boot in `index.js`)

| Agent | Schedule | Notes |
|---|---|---|
| **Job** | `0 7 * * *` | **Disabled** — `JOB_AGENT_CRON_ENABLED = false`; manual run-now only. Boot catch-up (`JOB_AGENT_CATCHUP_HOURS = 20`) is behind the same flag. |
| **Email** | `*/15 * * * *` | Cheap: `flagExists()` dedups, so a Claude call only fires on new mail. |
| **Morning brief** | `0 6,12,18 * * *` | |
| **Archivist** | `*/10 * * * *` | + chokidar HEAD watch. |
| **Accountability** | `0 20 * * *` | |
| **Council / Tagging / Research** | on-demand | |

---

## Deployment / Run

Local-only — there is no deploy. "Run" means starting both dev processes.

- **Install:** `npm install` at the repo root (frontend) and `cd server && npm install` (backend) — two `package.json`s.
- **Run:** backend `cd server && npm run dev` (or `npm start`) on `localhost:3001`; frontend `npm run dev` on `localhost:5173`. Backend must stay up for cron + watchers.
- **Environment:** all secrets in `server/.env` (gitignored). Ship `server/.env.example`. Never commit `.env` or `credentials.json`.

### Credentials (all in `server/.env`)
- `ANTHROPIC_API_KEY` — required, all agents.
- `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` — job agent (free tier 250/day). Muse + Jobicy need no key.
- **Gmail OAuth** (`credentials.json` + cached token) — email agent. Scope `gmail.readonly`. One-time `npm run gmail:auth`.
- `EMAIL_USER` + `EMAIL_APP_PASSWORD` + `EMAIL_RECIPIENT` — optional job report email (Nodemailer).
- `NEWS_API_KEY` — morning brief.
- `WATCHED_PROJECTS` — archivist (absolute local paths in `config.js`; sandboxed disk paths, not a credential).

---

## Project Structure

Single repo with `server/` nested: the Vite + React frontend is the root package; the Express backend is its own nested package. Two `package.json`s, one repo.

```
nexus/                       # repo root = the Vite + React frontend (port 5173)
├── master.html              # design source of truth
├── CLAUDE.md · AGENTS.md    # architecture source of truth (AGENTS.md = Codex mirror; keep in sync)
├── README.md                # clone + configure + run guide
├── index.html · vite.config.js · package.json
├── src/
│   ├── main.jsx · App.jsx · index.css · api.js
│   └── views/               # one component per tab: HomeView, JobsView, JournalView, GraphView,
│                            #   CouncilView, GoalsView, CalendarView, ResearchView, ProjectsView, SettingsView
└── server/                  # nested Express package — long-running agent host (port 3001)
    ├── index.js             # Express app + node-cron registration + boot run-reconciliation
    ├── config.js            # cities/terms/résumés + cron schedules + JOB_AGENT_CRON_ENABLED + WATCHED_PROJECTS + Gmail/news config
    ├── resumes/             # da_resume.tex / swe_resume.tex (gitignored)
    ├── credentials.json · gmail-token.json   # gitignored, owner-supplied
    ├── agents/              # jobAgent, emailAgent (+gmailAuth), councilAgent, accountabilityAgent,
    │                        #   morningBriefAgent, archivistAgent, tagAgent, researchAgent, claudeClient
    ├── db/                  # index.js (schema + additive migrations), schema.sql, and one repo per domain:
    │                        #   jobsRepo, notesRepo, goalsRepo, briefRepo, emailRepo, projectChangesRepo,
    │                        #   overviewRepo, observabilityRepo, researchRepo, settingsRepo, maintenance, nexus.db
    ├── routes/              # jobs, notes, council, accountability, brief, email, calendar, overview,
    │                        #   observability, research, settings
    └── scripts/             # migrate-jobs, purge-stale-jobs, gmail-auth, seed-second-brain
```

### Tables (`server/db/schema.sql` + additive migrations in `db/index.js`)
`jobs`, `job_seen_keys` (lifetime seen-set), `email_flags`, `calendar_events`, `goals`, `checkins`, `streaks`, `notes` (+ `parent_id`/`node_type`/`is_concept` hierarchy columns), `tags`, `note_tags`, `morning_brief` (+ `digest`/`digest_at`), `morning_brief_items`, `project_changes`, `council_sessions`, `council_responses`, observability/steering: `agent_runs`, `agent_usage`, `brief_interests`, `app_settings` (UI-editable agent overrides), research: `research_sessions`, `research_messages`, `research_open_questions`. SQLite can't add columns via `CREATE TABLE IF NOT EXISTS`, so new columns are additive migrations in `db/index.js`.

---

## Conventions

- **Naming:** camelCase JS vars/functions, PascalCase React components, snake_case SQL.
- **Commits:** conventional commits (feat / fix / chore / docs / style). Group by capability (a feature's backend + frontend together); `index.css` can be its own `style` commit when it spans features.
- **Branches:** work has been committed directly to `main` (solo repo). Confirm before changing that.
- **Error handling:** never swallow errors silently — agents run unattended, so log with context. Telemetry (claudeClient) is best-effort and must never break an agent.
- **Comments:** explain *why*, not *what*.
- **Tests:** none yet — establish per layer when added.

---

## Design System

- **Source:** `./master.html` — its `:root` CSS variables and each `.view` block. The single source of truth for UI; do not pull in any other design file.
- **Fonts:** Syne (UI) + JetBrains Mono (mono). Accent "elder purple" `#7c6fe0`; per-agent colors are CSS variables (`--job`, `--email`, `--council`, `--acct`, `--news`, `--project`).
- **Theme:** dark-only. Do not add a light theme.
- **Rule:** read the design source before touching styles; port tokens verbatim. Don't redesign.

---

## Do Not Touch

- `.env` / `server/.env` — never read, modify, or commit.
- `credentials.json` and the cached Gmail token — never commit/log.
- `nexus.db` — go through the DB layer / migrations, don't hand-edit.
- The Gmail scope — stay `gmail.readonly`; the email agent never sends or deletes.
- The archivist's filesystem reach — sandboxed to `WATCHED_PROJECTS`.
- `master.html` design tokens — port them; don't alter the design source to fit code.

---

## Current Priorities

Phases 1–9 are built; everything from here is making it sharper. Order isn't locked — the shared-context architecture lets any of these slot in.

1. **"Ask Nexus anything"** — a query layer over the accumulated knowledge/research nodes; resurface tracked open questions in the brief.
2. **First test suites** per layer (repos / agents / routes) + a prompt-cache cost audit.
3. **Richer agents** — full calendar grid + recurring/two-way; quantified goals + reminders + weekly review; multi-source brief + save-for-later + TTS; email thread summaries + *draft* replies (never auto-send) + per-sender rules; job-agent résumé/cover-letter drafts; archivist `file_save` + multi-repo + release notes.
4. **Proactivity** — agents learn preferences; proactive cross-agent nudges; daily/weekly self-review; per-task model routing.
5. **New agents & reach** — finance/health/learning (same prompt + tables pattern); desktop/push notifications + responsive layout; one-command setup.
6. **Hardening** — DB encryption at rest + backup/restore; a schema-migrations framework; indexing/pagination/graph virtualization at scale.

The full prose roadmap lives in the README. **This is the worst version of Nexus it will ever be.**

---

## Known Issues / gotchas

- All AI features need `ANTHROPIC_API_KEY` (+ `ADZUNA_*` for live job fetch, `NEWS_API_KEY` for the brief, Gmail OAuth for email). Without a key each agent degrades gracefully — nothing crashes.
- A full job run is slow (Adzuna per city × title, throttled) — it runs in the background and the UI polls `GET /api/jobs/run/status` (now with `phase` + `pct`). Job automation is **off**; trigger runs with **run now**.
- Ghosting is **derived** in the UI (status stays `applied`), because the `jobs.status` CHECK constraint can't add a value in place without a table rebuild. It auto-clears if the company replies.
- Email classification reads only From/Subject/snippet (~100 chars), not the full body — clear rejections/invites work; nuanced ones can be missed. One job per company (a company-only email flips/creates one row).
- Dotenv gotcha: a `KEY= # comment` line parses as empty — keep `.env` values free of inline comments.
- `node_type` is the second-brain taxonomy column; the legacy `kind` column is kept for back-compat (a SQLite CHECK can't be altered in place).
- Gmail deep-links use `mail.google.com/mail/u/0/#all/<id>` — assumes the primary signed-in account (`u/0`).

---

## Session Notes

Detailed session history lives in `.claude/session-notes.md`. Run `/session-end` to append a dated entry and refresh Current Priorities.

---

## Instructions for AI coding tools

- This file is authoritative for **architecture/stack**; `master.html` is authoritative for **design**. If something here conflicts with your defaults, **this file wins.**
- Keep `AGENTS.md` in sync with this file (it is the Codex mirror — same content, only the title/intro differ; the **Claude model** references stay "Claude").
- Keep the backend a **single long-running Express process** so cron + watchers persist. Never split agents into serverless functions.
- Every agent reads/writes the same SQLite — design the schema so cross-agent reads/writes are trivial.
- Never introduce a framework/database/dependency not in Stack without flagging it. Current deps: `express`, `better-sqlite3`, `node-cron`, `@anthropic-ai/sdk`, `nodemailer`, `googleapis`, `simple-git`, `chokidar`, `dotenv`, `cors`, `cron-parser` · frontend: `react`, `react-dom`, `react-force-graph-2d`, `vite` (+ `playwright` dev-only for screenshots).
- Keep the app local-only. Never bind to a public interface.
- Build incrementally — prefer one working slice over several half-built ones.
