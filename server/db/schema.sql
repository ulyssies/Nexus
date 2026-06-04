-- ============================================================
--  NEXUS — SQLite schema (better-sqlite3)
--  Single file: server/db/nexus.db
--
--  This is the shared context layer. Every agent reads/writes
--  here, so the schema is built for trivial CROSS-AGENT reads:
--    - email agent flips jobs.status     -> jobs.status + email_flags.related_job_id
--    - email agent adds deadlines        -> calendar_events.source_agent='email'
--    - accountability reads progress     -> goals + checkins + streaks
--    - council reads personal context    -> notes + goals
--    - archivist feeds the second brain   -> project_changes.note_id -> notes -> tags
--    - morning brief curates articles    -> morning_brief + morning_brief_items
--
--  Conventions:
--    - snake_case tables/columns
--    - id INTEGER PRIMARY KEY (rowid alias)
--    - timestamps are ISO-8601 TEXT, UTC, via datetime('now')
--    - every row records which agent wrote it (source_agent) where
--      more than one writer is possible
--    - status/enum columns are TEXT guarded by CHECK constraints
-- ============================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================
--  SECOND BRAIN — notes are the universal graph node.
--  Graph: nodes = rows here; edges = two notes sharing a tag.
--  Journal entries, free notes, and archivist summaries are all
--  notes (distinguished by `kind`) so the graph sees everything.
-- ============================================================
CREATE TABLE IF NOT EXISTS notes (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL DEFAULT 'note'
                 CHECK (kind IN ('note','journal','project','brief')),
  title        TEXT,
  body         TEXT NOT NULL,
  source_agent TEXT NOT NULL DEFAULT 'user',   -- user | archivist | ...
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_kind       ON notes(kind);
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at);

CREATE TABLE IF NOT EXISTS tags (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT                                   -- optional hex for the graph
);

-- join table: which tags a note carries. Tags are AI-assigned.
-- The graph derives an edge between any two notes that share a tag.
CREATE TABLE IF NOT EXISTS note_tags (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag  ON note_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(note_id);

-- ============================================================
--  JOBS — owned by the job agent, STATUS mutated by the email agent.
--  jobs.company is indexed so the email agent can match an inbound
--  email's sender/company to an application and flip its status.
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
  id                 INTEGER PRIMARY KEY,
  external_id        TEXT,                      -- provider's id (jobId from job-agent)
  source             TEXT,                      -- adzuna | muse | jobicy | external
  track             TEXT,                      -- swe | da (job-agent search track)
  title              TEXT NOT NULL,
  company            TEXT NOT NULL,
  location           TEXT,
  target_city        TEXT,                      -- city the search targeted
  url                TEXT,                      -- apply link
  description        TEXT,
  salary             TEXT,
  posted_at          TEXT,                      -- when the listing was posted
  match_score        REAL,                      -- matchPercent, 0–100 from the scorer
  match_category     TEXT,                      -- Excellent | Strong | Good | Fair | Low
  match_reasons      TEXT,                      -- JSON: { reason, missingSkills[] }
  entry_level_fit    INTEGER NOT NULL DEFAULT 0,-- 0/1 -> UI "Stretch"/"Entry"
  status             TEXT NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','interested','applied','interviewing',
                                         'offer','rejected','withdrawn','archived')),
  applied_at         TEXT,
  status_updated_at  TEXT,
  status_updated_by  TEXT,                      -- 'user' | 'email' | 'import' (cross-agent write)
  raw                TEXT,                      -- JSON of the original payload
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_jobs_status  ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_track   ON jobs(track);
CREATE INDEX IF NOT EXISTS idx_jobs_entry   ON jobs(entry_level_fit);

-- ============================================================
--  EMAIL FLAGS — owned by the email agent.
--  related_job_id is the cross-agent link: when the agent infers an
--  inbound email belongs to an application, it sets this FK and may
--  flip jobs.status in the same transaction.
-- ============================================================
CREATE TABLE IF NOT EXISTS email_flags (
  id               INTEGER PRIMARY KEY,
  gmail_message_id TEXT NOT NULL UNIQUE,
  thread_id        TEXT,
  sender           TEXT,
  sender_email     TEXT,
  subject          TEXT,
  snippet          TEXT,
  received_at      TEXT,
  importance       TEXT NOT NULL DEFAULT 'normal'
                     CHECK (importance IN ('urgent','important','normal','noise')),
  category         TEXT,                        -- AI label, freeform
  is_unread        INTEGER NOT NULL DEFAULT 1,  -- boolean 0/1
  deadline_at      TEXT,                        -- extracted deadline, if any
  related_job_id   INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  action_taken     TEXT,                        -- e.g. 'updated_job_status' | 'added_calendar_event'
  source_agent     TEXT NOT NULL DEFAULT 'email',
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_flags_job        ON email_flags(related_job_id);
CREATE INDEX IF NOT EXISTS idx_email_flags_importance ON email_flags(importance);
CREATE INDEX IF NOT EXISTS idx_email_flags_unread     ON email_flags(is_unread);

-- ============================================================
--  CALENDAR — written by the user AND by the email agent
--  (deadline extraction). source_agent + source_ref record origin
--  so a deadline can be traced back to the email that produced it.
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_events (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  start_at     TEXT NOT NULL,
  end_at       TEXT,
  all_day      INTEGER NOT NULL DEFAULT 0,      -- boolean 0/1
  location     TEXT,
  source_agent TEXT NOT NULL DEFAULT 'user'
                 CHECK (source_agent IN ('user','email','job','accountability')),
  source_ref   INTEGER,                          -- e.g. email_flags.id or jobs.id
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_calendar_start  ON calendar_events(start_at);
CREATE INDEX IF NOT EXISTS idx_calendar_source ON calendar_events(source_agent);

-- ============================================================
--  GOALS / STREAKS / CHECKINS — accountability agent reads all three.
--  Council also reads goals as personal context.
-- ============================================================
CREATE TABLE IF NOT EXISTS goals (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  category    TEXT,                              -- gym | project | study | application | ...
  target      TEXT,                              -- human target, e.g. '5x / week'
  cadence     TEXT,                              -- daily | weekly | ...
  target_date TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','paused','done','dropped')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);

-- one streak row per goal (cached aggregate the agent maintains)
CREATE TABLE IF NOT EXISTS streaks (
  goal_id            INTEGER PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE,
  current_count      INTEGER NOT NULL DEFAULT 0,
  longest_count      INTEGER NOT NULL DEFAULT 0,
  last_checkin_date  TEXT,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checkins (
  id           INTEGER PRIMARY KEY,
  goal_id      INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  checkin_date TEXT NOT NULL DEFAULT (date('now')),
  status       TEXT NOT NULL DEFAULT 'done'
                 CHECK (status IN ('done','partial','missed')),
  note         TEXT,                             -- nudge text or user comment
  source_agent TEXT NOT NULL DEFAULT 'accountability',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (goal_id, checkin_date)
);
CREATE INDEX IF NOT EXISTS idx_checkins_goal ON checkins(goal_id);
CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(checkin_date);

-- ============================================================
--  PROJECT CHANGES — archivist agent.
--  note_id links each change to a second-brain node so project
--  history is queryable as graph context by other agents.
-- ============================================================
CREATE TABLE IF NOT EXISTS project_changes (
  id            INTEGER PRIMARY KEY,
  project_name  TEXT NOT NULL,
  project_path  TEXT,
  change_type   TEXT NOT NULL DEFAULT 'commit'
                  CHECK (change_type IN ('commit','file_save')),
  commit_hash   TEXT,
  summary       TEXT NOT NULL,                   -- what changed
  why           TEXT,                            -- why
  impact        TEXT,                            -- impact
  diff_stat     TEXT,                            -- +/- lines, files touched
  note_id       INTEGER REFERENCES notes(id) ON DELETE SET NULL,  -- graph node
  source_agent  TEXT NOT NULL DEFAULT 'archivist',
  changed_at    TEXT,                            -- commit/save time
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_name, commit_hash)
);
CREATE INDEX IF NOT EXISTS idx_project_changes_name ON project_changes(project_name);
CREATE INDEX IF NOT EXISTS idx_project_changes_note ON project_changes(note_id);

-- ============================================================
--  MORNING BRIEF — one brief per day (parent) + its curated items.
--  Brief agent learns interests from notes/tags + goals.
-- ============================================================
CREATE TABLE IF NOT EXISTS morning_brief (
  id           INTEGER PRIMARY KEY,
  brief_date   TEXT NOT NULL UNIQUE DEFAULT (date('now')),
  summary      TEXT,                             -- intro / TL;DR for the day
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS morning_brief_items (
  id        INTEGER PRIMARY KEY,
  brief_id  INTEGER NOT NULL REFERENCES morning_brief(id) ON DELETE CASCADE,
  headline  TEXT NOT NULL,
  source_url TEXT,
  summary   TEXT,                                -- the ~10-min-read condensed copy
  topic     TEXT,                                -- matched interest/tag
  position  INTEGER NOT NULL DEFAULT 0           -- display order
);
CREATE INDEX IF NOT EXISTS idx_brief_items_brief ON morning_brief_items(brief_id);

-- ============================================================
--  COUNCIL OF 5 — on-demand reasoning. Stored so sessions persist
--  and the home/council view can replay them. Reads notes + goals.
-- ============================================================
CREATE TABLE IF NOT EXISTS council_sessions (
  id              INTEGER PRIMARY KEY,
  question        TEXT NOT NULL,
  consensus_score INTEGER CHECK (consensus_score BETWEEN 0 AND 100),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS council_responses (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES council_sessions(id) ON DELETE CASCADE,
  elder      TEXT NOT NULL
               CHECK (elder IN ('Marcus','Lyra','Zeno','Aria','Rex')),
  pass       INTEGER NOT NULL DEFAULT 1,         -- 1 = initial, 2 = challenge round
  stance     TEXT CHECK (stance IN ('agrees','neutral','challenges')),
  response   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_council_responses_session ON council_responses(session_id);

-- ============================================================
--  updated_at touch triggers for the mutable tables
-- ============================================================
CREATE TRIGGER IF NOT EXISTS trg_notes_updated AFTER UPDATE ON notes
BEGIN UPDATE notes SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_jobs_updated AFTER UPDATE ON jobs
BEGIN UPDATE jobs SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_goals_updated AFTER UPDATE ON goals
BEGIN UPDATE goals SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_calendar_updated AFTER UPDATE ON calendar_events
BEGIN UPDATE calendar_events SET updated_at = datetime('now') WHERE id = NEW.id; END;
