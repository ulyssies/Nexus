# Nexus

> **A personal AI operating system that runs entirely on your machine.** Six specialized AI agents share one brain — a single SQLite file holding your notes, goals, journal, jobs, inbox, and projects — so each agent can act on what the others know. An interview email doesn't just get flagged; it moves your job application to "interviewing." A commit doesn't just get logged; it becomes a node in your knowledge graph.

The shared context **is** the product. Most "AI assistants" are six disconnected chatbots; Nexus is six agents reading and writing the same memory.

### What it does for you

- 🧭 **Command center** — one home dashboard with live stats, every agent's status, and a merged activity feed across all of them.
- 💼 **Finds & scores jobs** — pulls live listings and ranks them against your résumé with Claude.
- 📨 **Triages your inbox** (read-only) — flags what's urgent, pulls deadlines onto your calendar, and updates job statuses when a recruiter writes back.
- 🧠 **Second brain** — journal entries and notes are auto-tagged and linked into a force-graph; shared tags become edges.
- 🏛️ **Council of 5** — five AI personas debate your decisions and rants, challenge each other, and land on a consensus.
- 🎯 **Keeps you accountable** — tracks goals, maintains streaks, and sends a nightly streak-aware nudge.
- 📰 **Morning brief** — learns your interests from your own notes and curates a short daily news read.
- 📚 **Project archivist** — watches your repos and turns commits into plain-English memory + graph nodes.

**Local-only by design.** Nexus runs on `localhost`, is never exposed publicly, and ships as a repo you clone and point at your own API keys. Filesystem and inbox access are exactly why it stays on your machine.

**Status:** Phases 1–6 complete — all six agents are built and running on schedule. Two need your own credentials to go fully live (Gmail OAuth for the email agent; a NewsAPI key for the brief); both degrade gracefully until then. See [Roadmap](#roadmap).

## Screens

**Home / command center** — the morning digest: live stat cards, every agent's status at a glance (click through to any tab), a merged cross-agent activity feed, your curated morning brief, and a goals snapshot. This is the one screen that shows the whole system working together.

**Job board** — live listings scored against your résumé, sorted by match, with a manual "run now" trigger.

![Job board](docs/screenshots/job-board.png)

**Journal** — free-form entries; an AI agent tags each one on save.

![Journal](docs/screenshots/journal.png)

**Second brain** — every note is a node; a shared tag is an edge. Click a node to preview it.

![Second-brain graph](docs/screenshots/graph.png)

**Council of 5** — five personas answer in parallel, challenge each other, and land on a consensus score (persona prompts are starter text you refine in your own voice).

![Council of 5](docs/screenshots/council.png)

---

## Architecture

Two processes on one machine, both local:

- **Frontend** — Vite + React 18 SPA on `http://localhost:5173`. A thin client that calls the backend's REST API; it never touches the database or external APIs directly.
- **Backend** — a single long-running Express process on `http://localhost:3001`. Hosts the REST API, every agent, all schedulers (`node-cron`), and file watchers. This is the piece that runs 24/7.
- **Database** — SQLite (`better-sqlite3`), one file at `server/db/nexus.db`. The shared context layer every agent reads and writes.

```
                          ┌──────────────────────────┐
   Gmail (read-only) ───▶ │                          │ ───▶ Job board status flips
   Job boards ──────────▶ │      nexus.db            │ ───▶ Calendar deadlines
   Your journal/notes ──▶ │  (shared context layer)  │ ───▶ Second-brain graph
   Your goals ──────────▶ │                          │ ───▶ Morning brief interests
   Your git repos ──────▶ │   every agent r/w here   │ ───▶ Council & nudge context
                          └──────────────────────────┘
```

### How the agents work together (the whole point)

Because every agent reads and writes the same `nexus.db`, work flows between them automatically:

- **Email → Jobs.** A recruiter emails "let's schedule your interview" → the email agent matches the company to an application and flips `jobs.status` to `interviewing`. You never touch the board.
- **Email → Calendar.** "Application due Friday" in an email → a deadline event appears on your calendar, traced back to the source email.
- **Journal → Brief & Council.** Your journal tags ("career", "health") teach the morning brief what news to curate, and the council reads recent entries to ground its advice in what you're actually going through.
- **Archivist → Second brain.** Each commit becomes a tagged graph node, so your project history connects to your journal themes by shared tags.
- **Everything → Home.** The command-center dashboard aggregates all of it into one live cross-agent feed.

The frontend never touches the DB or external APIs directly — every read and write goes through the Express backend, so the agents stay the single source of truth.

---

## Prerequisites

- **Node.js 18+** (the backend uses the global `fetch`; tested on Node 20/22/24).
- **npm**.
- An **Anthropic API key** (required for any agent that reasons).
- Per-agent API keys as you enable each agent (see [Configuration](#configuration)).

---

## Install

The repo is one project with the backend nested under `server/` — two `package.json` files.

```bash
# from the repo root (the frontend)
npm install

# the backend
cd server && npm install && cd ..
```

---

## Configuration

All secrets live in `server/.env` (gitignored — never commit it). Copy the example and fill it in:

```bash
cp server/.env.example server/.env
```

What each value is and how to get it:

| Variable | Needed for | How to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | **All agents** (required now) | [console.anthropic.com](https://console.anthropic.com) → API keys → Create key. Add billing. ~$10–15/mo for personal daily use with prompt caching. |
| `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` | **Job agent** (required now) | [developer.adzuna.com](https://developer.adzuna.com) → register → free tier (250 req/day). The Muse + Jobicy need no key. |
| `EMAIL_USER` + `EMAIL_APP_PASSWORD` + `EMAIL_RECIPIENT` | **Job report email** (optional — the run still works without it) | Gmail → [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) → generate a 16-char app password (requires 2FA). Used by Nodemailer to send the digest. |
| **Gmail OAuth** (`credentials.json`) | Email agent (Phase 5) | Google Cloud Console → new project → enable Gmail API → OAuth consent screen (External, add yourself as a test user) → create **OAuth Desktop** credentials → download `credentials.json` into `server/`. Then run once: `cd server && npm run gmail:auth` → open the printed URL, approve, paste the code back (token caches to `server/gmail-token.json`). Scope stays `gmail.readonly` — the agent never sends or deletes. |
| `NEWS_API_KEY` | Morning brief agent (Phase 5) | [newsapi.org](https://newsapi.org) free dev tier (or GNews/Currents). |
| `WATCHED_PROJECTS` | Project archivist (Phase 6) | Absolute local folder paths in `server/config.js`, e.g. `[{ name, path, type }]`. Not a credential — disk paths the watcher reads. Sandboxed to these paths only. |

For Phase 2 (the Job board) you only need `ANTHROPIC_API_KEY` and the two `ADZUNA_*` keys; email is optional.

---

## Run

Start both processes (two terminals). The backend must stay running for cron and watchers.

```bash
# terminal 1 — backend (port 3001)
cd server && npm run dev      # or: npm start

# terminal 2 — frontend (port 5173)
npm run dev
```

Open **http://localhost:5173**. The Vite dev server proxies `/api` to the backend, so the browser talks to one origin.

### Using the Job board

- The board renders live from SQLite, sorted by match score, with filters (all tracks / entry only / applied).
- **`↻ run now`** triggers the full pipeline on demand: fetch live listings (Adzuna/Jobicy/The Muse) → score against your résumé with Claude → write to SQLite → optional email digest. The button polls progress and the board refreshes when the run finishes.
- The same pipeline runs automatically on a **`node-cron` schedule (`0 7 */3 * *`** — 07:00 every 3rd day), registered when the backend boots. Each scheduled run also purges unapplied listings older than 30 days.

### Résumés and search settings

Search terms, target cities, scoring thresholds, the cron schedule, and résumé paths live in **`server/config.js`**. The scorer compares listings against the `.tex` résumés in `server/resumes/` (DA and SWE tracks) — **add your own there; they're gitignored so personal résumés never get committed.** Edit `config.js` to change what gets searched and which résumé scores each track.

### Maintenance scripts (run from `server/`)

```bash
npm run purge:jobs                 # delete unapplied jobs older than 30 days
npm run purge:jobs -- --dry-run    # preview the purge
npm run migrate:jobs /path/to/jobs.json   # one-time import of a legacy job-agent jobs.json
```

---

## The agents

| Agent | Status | What it does |
|---|---|---|
| **Job agent** | ✅ working (Phase 2) | Fetches + scores listings, writes to `jobs`, sends a 3-day email report. Runs on cron + the manual button. |
| **Email agent** | ✅ built (Phase 5) | Reads Gmail (read-only), classifies importance, extracts deadlines into the calendar, and auto-updates `jobs.status` by matching companies. Needs a one-time `npm run gmail:auth`; no-ops gracefully until then. |
| **Council of 5** | ✅ working (Phase 4) | Five personas (Marcus/Lyra/Zeno/Aria/Rex) answer in parallel, challenge each other, and a consensus score is computed. Reads journal + goals. Persona prompts are v1 to refine. |
| **Accountability** | ✅ built (Phase 5) | Tracks goals, maintains streaks (cache rebuilt from check-in history), and sends a nightly streak-aware nudge. Verified live. |
| **Morning brief** | ✅ built (Phase 5) | Learns your interests from the second brain (note tags + goals), fetches NewsAPI, and condenses ~6 stories into a morning read. Needs a real `NEWS_API_KEY`. |
| **Project archivist** | ✅ built (Phase 6) | Watches your code dirs, summarizes each commit with Claude into `project_changes` + a tagged second-brain graph node. Sandboxed to `WATCHED_PROJECTS`. Verified on this repo. |

---

## Project structure

```
nexus/                       # repo root = Vite + React frontend (port 5173)
├── master.html              # design source of truth (CSS variables + per-view markup)
├── index.html · vite.config.js · package.json
├── src/
│   ├── main.jsx · App.jsx · index.css · api.js
│   └── views/               # one component per tab: Home, Jobs, Journal, Graph,
│                            #   Council, Goals, Accountability, Calendar, Projects
└── server/                  # nested Express package — agent host (port 3001)
    ├── index.js             # Express app + node-cron registration for all 6 agents
    ├── config.js            # agent settings: cities, search terms, résumés, schedules, WATCHED_PROJECTS
    ├── resumes/             # .tex résumés the scorer compares against (gitignored)
    ├── agents/              # jobAgent, emailAgent (+gmailAuth), councilAgent, accountabilityAgent,
    │                        #   morningBriefAgent, archivistAgent, tagAgent
    ├── db/                  # better-sqlite3 connection, schema.sql, one repo per domain, overviewRepo
    ├── routes/              # jobs, notes, council, accountability, brief, email, calendar, overview
    └── scripts/             # migrate-jobs, purge-stale-jobs, gmail-auth
```

See [`CLAUDE.md`](./CLAUDE.md) for the full file-by-file tree and architecture notes.

---

## Roadmap

1. **Scaffold + DB** ✅ — frontend, server, SQLite schema, design ported.
2. **Job agent** ✅ — pipeline absorbed, cron wired, run button, board live.
3. **Journal + second brain** ✅ — journal with AI auto-tagging, notes in SQLite, force graph.
4. **Council of 5** ✅ — personas, challenge pass, consensus meter (Sonnet 4.6; cost-first). Plumbing + view done; persona prompts are v1 to refine.
5. **Email + accountability + morning brief** ✅ — Gmail read-only triage + cross-agent `jobs.status` flips, goals/streaks/nudge, interest-driven curation. Email + brief need your own credentials to go fully live.
6. **Project archivist** ✅ — git watcher, AI change summaries, tagged graph nodes. Verified on this repo.
7. **Home command center** ✅ — a cross-agent overview dashboard (stats + agent status + merged activity feed).

**Next:** iterate toward daily use — tune the council/triage/nudge prompts as they're used, and add your own repos to `WATCHED_PROJECTS`.

---

## Notes

- **Local-only by design.** Never bind to a public interface. There is no deploy step — "running" means starting the two dev processes above.
- **Single user, no app auth.** The only OAuth is Gmail read-only, used solely to read your inbox.
- **Don't commit** `server/.env`, `credentials.json`, or `server/db/nexus.db`.
- Architecture and build conventions for AI coding tools live in [`CLAUDE.md`](./CLAUDE.md); the design system lives in `master.html` (ported into `src/index.css`).
```
