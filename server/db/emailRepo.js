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

export function flagStats() {
  const row = (sql, ...a) => db.prepare(sql).get(...a).n;
  return {
    total: row('SELECT COUNT(*) n FROM email_flags'),
    urgent: row("SELECT COUNT(*) n FROM email_flags WHERE importance = 'urgent'"),
    unread: row('SELECT COUNT(*) n FROM email_flags WHERE is_unread = 1'),
    deadlines: row('SELECT COUNT(*) n FROM email_flags WHERE deadline_at IS NOT NULL'),
  };
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
export function listUpcomingEvents(limit = 50) {
  return db.prepare(
    "SELECT * FROM calendar_events WHERE start_at >= datetime('now','-1 day') ORDER BY start_at ASC LIMIT ?"
  ).all(limit);
}

export function listAllEvents(limit = 200) {
  return db.prepare('SELECT * FROM calendar_events ORDER BY start_at ASC LIMIT ?').all(limit);
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
