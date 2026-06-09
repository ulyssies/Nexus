# Handoff

Continuity note for the next session. Read **`CLAUDE.md`** (architecture, now current) and **`AGENTS.md`** (its Codex mirror) first; `master.html` is the design source of truth. This file is a short pointer — `CLAUDE.md` holds the full current state.

## Where things stand

Phases 1–9 are built and live. Work is committed directly to **`main`** and pushed to `origin`. CLAUDE.md / AGENTS.md were rewritten to reflect current reality (they had drifted).

## Recent direction (what changed most recently)

- **Job agent** — automation **off** (`JOB_AGENT_CRON_ENABLED = false`); manual **run now** only, with a compact `phase`+`pct` progress bar. **Lean scoring** (reason + missing skills, `max_tokens: 2500`) — the old structured role-summary output was removed for cost. Board split into **Found / Live applications / Inactive** (with derived **ghosted**), a per-company **♥ shortlist** heart, and a **new-this-scan** badge. **Settings → Job agent** edits locations / terms / résumés (via `app_settings` + `settingsRepo` + `routes/settings.js`).
- **Email agent** — every 15 min; now **creates** applications from email (e.g. LinkedIn) when the company isn't tracked; promo "offer expires" mail no longer becomes a calendar deadline. The **agent rail** is individual, timestamped, expandable cards that deep-link to Gmail, with a last-scan line.
- **Morning brief** — **topic-driven** from the Settings news tags (`brief_interests` + `QUERY_EXPANSIONS`), fetches real article bodies, runs 6/12/18.
- **Archivist** — every 10 min; commits go to the **Projects changelog only**, no longer into the knowledge graph.
- **Second brain** — graph curated to meaningful nodes (`isGraphWorthy` excludes commits + thin notes), force-tuned for a clean constellation.
- **Research** — unsaved sessions are deletable.

## Before pushing

- Run the standard secret/PII audit (`git diff` for keys/passwords/tokens; confirm `.env`, `credentials.json`, Gmail token, `nexus.db`, résumés stay untracked).
- **Audit screenshots for personal data.** They're generated from the live dashboard and may contain real inbox/calendar/jobs. The Found-by-agent job board and the graph (labels are hover-only) are safe; Home/Calendar/Goals/Live-applications would expose real data.

## Watch / next

- `CLAUDE.md` → **Current Priorities** is the live list (Ask-Nexus query layer, first test suites, richer agents, …).
- No test suites yet — first candidate when touching repos/agents/routes.
