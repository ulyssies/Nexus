// ============================================================
//  Email flags + calendar — the email agent's write layer, and the
//  cross-agent bridge into jobs.
//
//  This is where Nexus's "shared context" pays off: an inbound email that
//  reads like an interview invite from a company you've applied to flips
//  jobs.status in the SAME pass that records the flag — one inbox event,
//  two tables updated. findJobByCompany() + setJobStatus() are that bridge.
//
//  Owns email_flags + calendar_events; reaches into jobs only through the
//  two explicit helpers below (company match + status set).
// ============================================================
import db from './index.js';

// ── email_flags ──────────────────────────────────────────────────────────────
const upsertFlagStmt = db.prepare(`
  INSERT INTO email_flags
    (gmail_message_id, thread_id, sender, sender_email, subject, snippet,
     received_at, importance, category, is_unread, deadline_at, related_job_id, action_taken)
  VALUES
    (@gmail_message_id, @thread_id, @sender, @sender_email, @subject, @snippet,
     @received_at, @importance, @category, @is_unread, @deadline_at, @related_job_id, @action_taken)
  ON CONFLICT (gmail_message_id) DO UPDATE SET
    importance     = excluded.importance,
    category       = excluded.category,
    is_unread      = excluded.is_unread,
    deadline_at    = excluded.deadline_at,
    related_job_id = excluded.related_job_id,
    action_taken   = excluded.action_taken`);

export function upsertFlag(flag) {
  upsertFlagStmt.run({
    thread_id: null, sender: null, sender_email: null, subject: null, snippet: null,
    received_at: null, importance: 'normal', category: null, is_unread: 1,
    deadline_at: null, related_job_id: null, action_taken: null,
    ...flag,
  });
  return db.prepare('SELECT * FROM email_flags WHERE gmail_message_id = ?').get(flag.gmail_message_id);
}

/** Has this message already been processed? (skip re-classifying on refresh) */
export const flagExists = (gmailMessageId) =>
  !!db.prepare('SELECT 1 FROM email_flags WHERE gmail_message_id = ?').get(gmailMessageId);

/** Flags for the UI, newest first; optional importance floor (urgent/important). */
export function listFlags({ importance = null, limit = 100 } = {}) {
  const rows = importance
    ? db.prepare('SELECT * FROM email_flags WHERE importance = ? ORDER BY received_at DESC LIMIT ?').all(importance, limit)
    : db.prepare('SELECT * FROM email_flags ORDER BY received_at DESC LIMIT ?').all(limit);
  return rows;
}

// The inbox filter tabs map to a WHERE clause. importance is a strict enum;
// the category tabs match the AI's freeform category labels by substring (the
// agent emits e.g. 'job-alert', 'recruiter', 'newsletter', 'promo').
function filterClause(filter) {
  switch (filter) {
    case 'urgent':     return "importance = 'urgent'";
    case 'important':  return "importance = 'important'";
    case 'noise':      return "importance = 'noise'";
    case 'job-alert':  return "(category LIKE '%job%' OR category LIKE '%recruit%' OR category LIKE '%application%')";
    case 'newsletter': return "(category LIKE '%news%' OR category LIKE '%promo%' OR category LIKE '%market%' OR category LIKE '%alumni%')";
    case 'all':
    default:           return "importance != 'noise'";   // default view hides noise
  }
}

/** Paginated, filtered inbox + total for the pager. */
export function listFlagsPaged({ filter = 'all', page = 1, pageSize = 25 } = {}) {
  const where = filterClause(filter);
  const total = db.prepare(`SELECT COUNT(*) n FROM email_flags WHERE ${where}`).get().n;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const flags = db.prepare(
    `SELECT * FROM email_flags WHERE ${where} ORDER BY received_at DESC, id DESC LIMIT ? OFFSET ?`
  ).all(pageSize, (p - 1) * pageSize);
  return { flags, total, page: p, pages, pageSize };
}

/** Per-tab counts for the filter bar (and the "show N noise" toggle). */
export function flagCounts() {
  const c = (sql) => db.prepare(`SELECT COUNT(*) n FROM email_flags ${sql}`).get().n;
  return {
    all:        c("WHERE importance != 'noise'"),
    urgent:     c("WHERE importance = 'urgent'"),
    important:  c("WHERE importance = 'important'"),
    'job-alert':c(`WHERE ${filterClause('job-alert')}`),
    newsletter: c(`WHERE ${filterClause('newsletter')}`),
    noise:      c("WHERE importance = 'noise'"),
    total:      c(''),
  };
}

export function flagStats() {
  const row = (sql, ...a) => db.prepare(sql).get(...a).n;
  return {
    total: row('SELECT COUNT(*) n FROM email_flags'),
    urgent: row("SELECT COUNT(*) n FROM email_flags WHERE importance = 'urgent'"),
    unread: row('SELECT COUNT(*) n FROM email_flags WHERE is_unread = 1'),
    deadlines: row('SELECT COUNT(*) n FROM email_flags WHERE deadline_at IS NOT NULL'),
  };
}

// ── agent communication rail — plain-language insights from the last scan ─────
// Read-only DERIVATION from what the agent already classified (no agent logic
// here): deadlines it extracted, recruiters/job-alerts it saw, urgent items it
// flagged, and any cross-agent job-status flips it made.
const epochMs = (ts) => {
  if (!ts) return 0;
  const t = Date.parse(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : 0;
};
function whenLabel(ts) {
  const t = epochMs(ts);
  if (!t) return '';
  const days = Math.round((t - Date.now()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 7) return `in ${days} days`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const clip = (s, n) => { const t = String(s || ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const clock = (ts) => new Date(epochMs(ts)).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * The agent rail: INDIVIDUAL, actionable cards (not aggregated counts) — each
 * carries the source email's gmail_message_id (so the UI can deep-link to it),
 * its received time, and a deadline time where relevant. Ordered most-actionable
 * first: deadlines → urgent → recruiters → cross-agent actions → a volume note.
 */
export function emailInsights() {
  const out = [];

  // 1) deadlines the agent extracted (most actionable) — link back to the email.
  // Excludes promo/noise sources so marketing "offer expires" junk never shows.
  for (const e of db.prepare(`
    SELECT c.title, c.start_at, f.gmail_message_id AS mid, f.received_at AS recv, f.sender, f.snippet AS snip
      FROM calendar_events c
      LEFT JOIN email_flags f ON f.id = c.source_ref
     WHERE c.source_agent = 'email' AND c.start_at >= datetime('now','-1 day')
       AND (f.importance IS NULL OR f.importance != 'noise')
       AND (f.category IS NULL OR f.category NOT LIKE '%promo%')
     ORDER BY c.start_at ASC LIMIT 8`).all()) {
    out.push({ kind: 'deadline', title: e.title, detail: `${whenLabel(e.start_at)} · ${clock(e.start_at)}`, sender: e.sender, snippet: e.snip, at: e.start_at, receivedAt: e.recv, messageId: e.mid });
  }
  for (const f of db.prepare(`
    SELECT subject, sender, deadline_at, gmail_message_id AS mid, received_at AS recv, snippet AS snip FROM email_flags
     WHERE deadline_at IS NOT NULL AND deadline_at >= datetime('now','-1 day')
       AND importance != 'noise' AND (category IS NULL OR category NOT LIKE '%promo%')
       AND NOT EXISTS (SELECT 1 FROM calendar_events c WHERE c.source_agent='email' AND c.start_at = email_flags.deadline_at)
     ORDER BY deadline_at ASC LIMIT 5`).all()) {
    out.push({ kind: 'deadline', title: clip(f.subject, 52), detail: `${whenLabel(f.deadline_at)} · ${clock(f.deadline_at)}`, sender: f.sender, snippet: f.snip, at: f.deadline_at, receivedAt: f.recv, messageId: f.mid });
  }

  // 2) urgent — one card each
  for (const u of db.prepare("SELECT subject, sender, received_at AS recv, gmail_message_id AS mid, snippet AS snip FROM email_flags WHERE importance = 'urgent' ORDER BY received_at DESC LIMIT 6").all()) {
    out.push({ kind: 'urgent', title: clip(u.subject, 52), detail: u.sender || 'unknown sender', sender: u.sender, snippet: u.snip, at: null, receivedAt: u.recv, messageId: u.mid });
  }

  // 3) recruiters reaching out — one card each (reply-worthy)
  for (const r of db.prepare("SELECT subject, sender, received_at AS recv, gmail_message_id AS mid, snippet AS snip FROM email_flags WHERE category LIKE '%recruit%' ORDER BY received_at DESC LIMIT 5").all()) {
    out.push({ kind: 'job', title: clip(r.subject, 50), detail: `recruiter · ${r.sender || 'unknown'}`, sender: r.sender, snippet: r.snip, at: null, receivedAt: r.recv, messageId: r.mid });
  }

  // 4) cross-agent actions the agent took — one card each
  for (const f of db.prepare("SELECT subject, sender, action_taken, received_at AS recv, gmail_message_id AS mid, snippet AS snip FROM email_flags WHERE action_taken IS NOT NULL ORDER BY received_at DESC LIMIT 5").all()) {
    const act = String(f.action_taken).replace('updated_job_status:', 'job → ').replace('created_application:', 'tracked → ');
    out.push({ kind: 'action', title: clip(f.subject, 48), detail: act, sender: f.sender, snippet: f.snip, at: null, receivedAt: f.recv, messageId: f.mid });
  }

  // 5) job-alert volume (not individually actionable) — one summary card
  const jobAlerts = db.prepare("SELECT COUNT(*) n FROM email_flags WHERE category LIKE '%job%' OR category LIKE '%alert%' OR category LIKE '%application%'").get().n;
  if (jobAlerts) {
    const top = db.prepare("SELECT sender, COUNT(*) n FROM email_flags WHERE category LIKE '%job%' OR category LIKE '%alert%' OR category LIKE '%application%' GROUP BY sender ORDER BY n DESC LIMIT 1").get();
    out.push({ kind: 'info', title: `${jobAlerts} job alerts in your inbox`, detail: top?.sender ? `mostly from ${top.sender}` : '', sender: null, at: null, receivedAt: null, messageId: null });
  }

  if (!out.length) {
    const total = db.prepare('SELECT COUNT(*) n FROM email_flags').get().n;
    out.push({ kind: 'info', title: total ? `Triaged ${total} emails` : 'No emails triaged yet', detail: total ? 'nothing pressing right now' : 'run a scan to start', sender: null, at: null, receivedAt: null, messageId: null });
  }
  return out;
}

/** Rail metadata: when the email agent last scanned, and how much it has triaged. */
export function emailRailMeta() {
  const lastScan = db.prepare("SELECT MAX(COALESCE(finished_at, started_at)) v FROM agent_runs WHERE agent = 'email' AND status = 'ok'").get()?.v
    || db.prepare('SELECT MAX(received_at) v FROM email_flags').get()?.v
    || null;
  const triaged = db.prepare('SELECT COUNT(*) n FROM email_flags').get().n;
  const urgent = db.prepare("SELECT COUNT(*) n FROM email_flags WHERE importance = 'urgent'").get().n;
  return { lastScan, triaged, urgent };
}

// ── calendar_events (also written by the email agent: extracted deadlines) ────
const insertEventStmt = db.prepare(`
  INSERT INTO calendar_events (title, description, start_at, end_at, all_day, location, source_agent, source_ref)
  VALUES (@title, @description, @start_at, @end_at, @all_day, @location, @source_agent, @source_ref)`);

// avoid duplicate deadline events when a refresh re-sees the same email
const eventExistsStmt = db.prepare(
  "SELECT id FROM calendar_events WHERE source_agent = 'email' AND source_ref = ? AND start_at = ?");

export function addCalendarEvent(ev) {
  if (ev.source_agent === 'email' && ev.source_ref != null) {
    const dup = eventExistsStmt.get(ev.source_ref, ev.start_at);
    if (dup) return db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(dup.id);
  }
  const info = insertEventStmt.run({
    description: null, end_at: null, all_day: 0, location: null,
    source_agent: 'user', source_ref: null, ...ev,
  });
  return db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(info.lastInsertRowid);
}

/** Upcoming events (today onward), soonest first — the calendar's "upcoming". */
// Email-sourced events also carry the source email's snippet + message id so the
// UI can show a brief description and deep-link to Gmail.
const EVENT_SELECT = `
  SELECT c.*, f.snippet AS email_snippet, f.gmail_message_id AS gmail_message_id, f.sender AS email_sender
    FROM calendar_events c
    LEFT JOIN email_flags f ON f.id = c.source_ref AND c.source_agent = 'email'`;

export function listUpcomingEvents(limit = 50) {
  return db.prepare(`${EVENT_SELECT} WHERE c.start_at >= datetime('now','-1 day') ORDER BY c.start_at ASC LIMIT ?`).all(limit);
}

export function listAllEvents(limit = 200) {
  return db.prepare(`${EVENT_SELECT} ORDER BY c.start_at ASC LIMIT ?`).all(limit);
}

// ── cross-agent bridge into jobs ──────────────────────────────────────────────
// Match an email's company to an application. Tries exact (indexed, NOCASE)
// then a contains-match so "Stripe" matches "Stripe, Inc.". Prefers rows the
// user is actually tracking (not still 'new') so a generic match doesn't
// hijack an unrelated listing.
export function findJobByCompany(company) {
  if (!company || !String(company).trim()) return null;
  const c = String(company).trim();
  return db.prepare(`
    SELECT * FROM jobs
     WHERE company = @c COLLATE NOCASE
        OR company LIKE '%' || @c || '%' COLLATE NOCASE
        OR @c LIKE '%' || company || '%' COLLATE NOCASE
     ORDER BY (status != 'new') DESC, status_updated_at DESC NULLS LAST, match_score DESC
     LIMIT 1`).get({ c });
}

const VALID_JOB_STATUS = new Set(['new', 'interested', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn', 'archived']);

/** Flip a job's status as a cross-agent write (records who/when). */
export function setJobStatus(jobId, status, by = 'email') {
  if (!VALID_JOB_STATUS.has(status)) throw new Error(`invalid job status: ${status}`);
  const info = db.prepare(`
    UPDATE jobs
       SET status = ?, status_updated_at = datetime('now'), status_updated_by = ?,
           applied_at = CASE WHEN ? = 'applied' AND applied_at IS NULL THEN datetime('now') ELSE applied_at END
     WHERE id = ?`).run(status, by, status, jobId);
  return info.changes > 0;
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const upsertEmailApp = db.prepare(`
  INSERT INTO jobs (external_id, source, title, company, url, status, applied_at, status_updated_at, status_updated_by, created_at)
  VALUES (@ext, 'email', @title, @company, @url, @status, @appliedAt, @at, 'email', @at)
  ON CONFLICT (source, external_id) DO UPDATE SET
    status            = excluded.status,
    status_updated_at = excluded.status_updated_at,
    status_updated_by = 'email',
    applied_at        = COALESCE(jobs.applied_at, excluded.applied_at),
    title             = CASE WHEN jobs.title = 'Application (via email)' THEN excluded.title ELSE jobs.title END`);

/**
 * Record an application the agent learned about from email but that isn't in the
 * jobs table (e.g. you applied on LinkedIn, not via the agent). Keyed on
 * company(+role) so repeated emails update the same row instead of duplicating.
 * `at` should be the email's received date so ghosting math is accurate on a
 * backfill. Returns the created/updated job row.
 */
export function recordEmailApplication({ company, role = null, status, url = null, at = null }) {
  const co = String(company || '').trim();
  if (!co) return null;
  if (!VALID_JOB_STATUS.has(status)) throw new Error(`invalid job status: ${status}`);
  const when = at || new Date().toISOString();
  const title = (role && String(role).trim()) || 'Application (via email)';
  const ext = `email:${slug(co)}${role ? ':' + slug(role) : ''}`;
  const appliedAt = status === 'applied' ? when : null;
  upsertEmailApp.run({ ext, title, company: co, url, status, appliedAt, at: when });
  return db.prepare('SELECT * FROM jobs WHERE source = ? AND external_id = ?').get('email', ext);
}
