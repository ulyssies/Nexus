# Claude Code Handoff

Continuity note for the next session. Read `CLAUDE.md` (architecture) and `AGENTS.md` (Codex mirror) first; `master.html` is the design source of truth.

## Where things stand

Phases 1–9 are built and live. This session was a large **UI/UX overhaul** plus two backend additions, all on the branch **`feat/ui-overhaul`** (not yet merged to `main`, not pushed).

### What changed this session

**Home — rebuilt as a 5-zone command center** (`HomeView.jsx`, `GET /api/home` via `getHome()` in `overviewRepo.js` + `homeRouter`):
- Zone 1 alert strip (urgent/actionable only, hidden when empty).
- Zone 2 today's agenda — active goals with one-click check-in (now **compact single-line rows, bounded scroll** so the column fits without scrolling) + a **MiniCalendar month-grid widget** (source-colored chips, click-a-day popover, month nav, reads `/api/calendar`) + job deadlines.
- Zone 3 morning-brief **digest** — a cached Claude-written read, now **4–6+ topic-labeled paragraphs** (**AI & Engineering / Career / Learning**), substantive and scannable (rewritten prompt in `morningBriefAgent.js` → `buildDigest()`; cached on `morning_brief.digest`/`digest_at`, regenerated only when stale >6h or forced via `POST /api/brief/digest`). Renders in a bounded `.digest-scroll`.
- Zone 4 agent feed — full, filterable, archivist-collapsed; capped scroll.
- Zone 5 agent-health cards — dot + last/next run + one real insight line.

**Calendar & Email — true three-panel layout** (`CalendarView.jsx`, draggable dividers):
- Full month calendar grid · paginated inbox (filter tabs all/urgent/important/job-alert/newsletter/noise + counts, noise hidden by default, expandable detail rows, cross-agent action badges) · agent communication rail (plain-language insight cards).
- Backend: `emailRepo.listFlagsPaged`/`flagCounts`/`emailInsights`; `routes/email.js` gained `/counts`, `/insights`, paged `/flags` (legacy `?importance=` preserved).

**Second Brain — split-pane graph** (`GraphView.jsx`):
- Force graph + rich right node panel (slides in on click, draggable divider persisted in localStorage).
- Weighted nodes by connection count; distinct color-by-type; **solid hierarchy vs dashed tag edges**; cluster-focus mode on concept click; search-highlight + node-type show/hide toggles.
- Node names now show **on hover only** (no overlapping canvas labels), and forces are tuned (strong charge repulsion + loosened tag-link strength) so the graph spreads out instead of blobbing.
- Right panel: type badge, full body (`/notes/:id`), clickable tags (→ filter)/parent/children/connected, date, source agent, close X.

**Goals + Accountability — merged into one tab** (`GoalsView.jsx`):
- One tab: stat cards · goals list (add form, per-goal streak + progress, today's check-in done/partial/missed, **delete button**) · accountability nudge card.
- `AccountabilityView.jsx` **deleted** (folded in). `App.jsx` drops the Accountability nav entry; the `accountability` route id is aliased to `GoalsView`; Home links repointed to `goals` in `overviewRepo.js`.

**Other:**
- Second-brain seed: `server/scripts/seed-second-brain.js` (`npm run seed:brain`, `--reset`) — concept hierarchy + tagged child nodes for a healthy demo graph. The owner intends to wipe seeds (`source_agent='seed'`) once real notes accumulate.
- Demo GIF recorder: `scripts/record-demos.mjs` (`npm run record:demos`, Playwright→ffmpeg). **Not run** — Playwright/Chromium/ffmpeg aren't installed here; see `docs/gifs/README.md`.
- `docs/screenshots/home.png` replaced with the new home UI (owner-supplied).

## Verification

- `npm run build` green after every change.
- All new endpoints verified live: `/api/home`, `/api/brief/digest` (synthesis + caching), `/api/email/{counts,insights,flags}` (paged/filtered), graph `/notes/:id`. Digest regen produced the new topic-labeled format. Add→delete goal cycle verified end-to-end (then cleaned up).
- Could **not** verify visually in a browser (no headless rendering in this env) — build + endpoint contracts only.

## ⚠️ Before pushing

- **`docs/screenshots/home.png` contains some real data** — notably "Payment due reminder for your Discover card" and the owner's actual goals. The repo has a public remote (`github.com/ulyssies/Nexus`) and the README says screenshots use "not real personal data." Decide whether to keep it or swap for a seeded screenshot before pushing; the README disclaimer may need updating either way.
- Run the standard secret/PII audit before any push (done for the code diff this session — clean).

## Suggested next steps

1. Owner: review/merge `feat/ui-overhaul`; decide on the home screenshot (above).
2. Regenerate the other README screenshots/GIFs (Calendar, Graph, Goals) to match the new UI — needs a browser; `npm run record:demos` once Playwright+ffmpeg are installed.
3. Visually QA the graph force-tuning (charge `-280`, tag-link strength `0.035` in `GraphView.jsx`) and the three-panel calendar dividers in the browser.
