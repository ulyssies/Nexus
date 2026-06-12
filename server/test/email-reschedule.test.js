// ============================================================
//  Integration test: an email that RESCHEDULES an event must MOVE the existing
//  calendar event (not duplicate it), and the email agent must stay aware of the
//  change — its insight/rail cards show the new time, the stale one is gone.
//
//  Runs against a throwaway DB (NEXUS_DB_PATH set before db/index.js is imported)
//  so the real nexus.db is never touched. No test framework — Node's built-in
//  node:test + node:assert. Run: `npm test` (or `node --test`) from server/.
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

// must be set BEFORE db/index.js opens the connection
const dir = mkdtempSync(join(tmpdir(), 'nexus-test-'));
process.env.NEXUS_DB_PATH = join(dir, 'test.db');

const { default: db } = await import('../db/index.js');
const { upsertFlag, addCalendarEvent, emailInsights, listUpcomingEvents } = await import('../db/emailRepo.js');
const { eventKeyFor } = await import('../agents/emailAgent.js');

after(() => rmSync(dir, { recursive: true, force: true }));

// Mirror the email agent's per-message write path (the real upsertFlag +
// addCalendarEvent + eventKeyFor it runs), fed the classification Claude returns.
function ingest({ id, threadId, subject, receivedAt, c }) {
  const flag = upsertFlag({
    gmail_message_id: id, thread_id: threadId,
    sender: c.sender || 'Acme Recruiting', sender_email: 'recruiting@acme.example',
    subject, snippet: subject, received_at: receivedAt,
    importance: c.importance || 'important', category: c.category || null,
    is_unread: 1, deadline_at: c.deadline || null,
  });
  if (c.deadline) {
    addCalendarEvent({
      title: c.deadlineTitle || subject, description: `From ${c.sender || 'Acme'}: ${subject}`,
      start_at: c.deadline, source_agent: 'email', source_ref: flag.id,
      event_key: eventKeyFor({ thread_id: threadId }, c), received_at: receivedAt,
    });
  }
  return flag;
}

const accEvents = () => listUpcomingEvents().filter((e) => /Acme/i.test(e.title));
const deadlineCards = () => emailInsights().filter((card) => card.kind === 'deadline');

// the interview: Mon Jun 15 2026 → rescheduled to Wed Jun 17 2026
const INTERVIEW = { sender: 'Acme Recruiting', category: 'interview', statusSignal: 'interviewing', deadlineTitle: 'Acme Screen Virtual Interview' };
const MON = '2026-06-15T18:00:00Z';
const WED = '2026-06-17T18:00:00Z';

test('eventKeyFor: an interview keys on the company (survives a fresh-thread reschedule)', () => {
  assert.equal(eventKeyFor({ thread_id: 't1' }, { ...INTERVIEW, company: 'Acme' }), 'co:acme:interview');
  // a non-interview deadline falls back to the Gmail thread
  assert.equal(eventKeyFor({ thread_id: 't9' }, { category: 'billing', company: null }), 'thr:t9');
});

test('a reschedule email moves the calendar event and the agent stays aware', () => {
  // 1) original interview lands on the calendar
  ingest({ id: 'm1', threadId: 'thread-acc', subject: 'Your Screen Virtual at Acme', receivedAt: '2026-06-12T10:00:00Z',
    c: { ...INTERVIEW, company: 'Acme', deadline: MON } });

  let cal = accEvents();
  assert.equal(cal.length, 1, 'exactly one Acme event after the original');
  assert.equal(cal[0].start_at, MON, 'calendar shows the original Monday time');
  assert.ok(deadlineCards().some((c) => c.at === MON), 'agent rail surfaces the Monday deadline');

  // 2) the reschedule arrives later (even on a fresh thread — keys on company)
  const original = db.prepare("SELECT id FROM email_flags WHERE gmail_message_id='m1'").get().id;
  ingest({ id: 'm2', threadId: 'thread-acc-new', subject: 'Updated times for your Screen Virtual at Acme', receivedAt: '2026-06-12T15:00:00Z',
    c: { ...INTERVIEW, company: 'Acme', deadline: WED } });

  // visible change in the calendar: same single event, now on Wednesday
  cal = accEvents();
  assert.equal(cal.length, 1, 'still ONE Acme event — moved, not duplicated');
  assert.equal(cal[0].start_at, WED, 'calendar now shows the new Wednesday time');

  // the agent is aware: a card at the new time, and the stale one is gone
  const cards = deadlineCards();
  assert.ok(cards.some((c) => c.at === WED), 'agent rail surfaces the new Wednesday deadline');
  assert.ok(!cards.some((c) => c.at === MON), 'stale Monday deadline no longer surfaced');

  // and at the data level: the superseded email's deadline is voided
  assert.equal(db.prepare('SELECT deadline_at FROM email_flags WHERE id=?').get(original).deadline_at, null,
    'superseded email deadline cleared');
});

test('an out-of-order (older) email cannot drag the time back', () => {
  // re-deliver the ORIGINAL email's time again, after the reschedule already applied
  ingest({ id: 'm1b', threadId: 'thread-acc', subject: 'Your Screen Virtual at Acme', receivedAt: '2026-06-12T10:00:00Z',
    c: { ...INTERVIEW, company: 'Acme', deadline: MON } });

  const cal = accEvents();
  assert.equal(cal.length, 1, 'no duplicate created by the stale re-delivery');
  assert.equal(cal[0].start_at, WED, 'time stays on Wednesday (newest email wins)');
});
