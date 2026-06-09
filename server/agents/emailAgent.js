// ============================================================
//  EMAIL AGENT — read-only Gmail triage that feeds the shared context.
//
//  Per run (daily cron + manual refresh):
//    1. list recent inbox messages (gmail.readonly), skip already-flagged.
//    2. batch-classify them with Claude (one call): importance, category,
//       any deadline, and whether the sender maps to a job application.
//    3. write email_flags; extract deadlines into calendar_events; and when
//       an email reads like movement on an application, flip jobs.status —
//       the cross-agent write that makes the inbox update the job board.
//
//  NEVER sends or deletes — scope is gmail.readonly (see gmailAuth.js).
//  Degrades gracefully: no credentials / not-yet-authorized / no Anthropic
//  key each return a clear, non-crashing status the route surfaces.
// ============================================================
import { trackedCreate, startRun, finishRun } from './claudeClient.js';
import { getGmailClient, gmailStatus } from './gmailAuth.js';
import { EMAIL_SCAN_COUNT } from '../config.js';
import { upsertFlag, flagExists, addCalendarEvent, findJobByCompany, setJobStatus, recordEmailApplication } from '../db/emailRepo.js';

const MODEL = 'claude-sonnet-4-6'; // importance + status inference; Sonnet, not Opus

// classifier signal → jobs.status (only "real movement" maps to a flip)
const SIGNAL_TO_STATUS = { applied: 'applied', interviewing: 'interviewing', offer: 'offer', rejected: 'rejected' };

const header =(headers, name) => (headers.find((h) => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';
// "Jane Doe <jane@acme.com>" → { name, email }
function parseFrom(from) {
  const m = from.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/) || from.match(/^\s*<?([^<>]+@[^<>]+)>?\s*$/);
  if (!m) return { name: from.trim(), email: '' };
  return m[2] ? { name: m[1].trim() || m[2], email: m[2].trim() } : { name: m[1].trim(), email: m[1].trim() };
}
// ISO from Gmail internalDate (ms epoch string)
const isoFromInternal = (ms) => ms ? new Date(Number(ms)).toISOString() : null;

// Pull inbox messages as lightweight records. Normally skips already-flagged
// messages; with reprocess=true it re-reads everything in the window (used by
// the backfill so previously-flagged application emails get re-evaluated).
async function fetchMessages(gmail, scanCount = EMAIL_SCAN_COUNT, reprocess = false) {
  const list = await gmail.users.messages.list({ userId: 'me', maxResults: scanCount, q: 'in:inbox newer_than:14d' });
  const ids = (list.data.messages || []).map((m) => m.id).filter((id) => reprocess || !flagExists(id));
  const out = [];
  for (const id of ids) {
    const { data } = await gmail.users.messages.get({
      userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'],
    });
    const headers = data.payload?.headers || [];
    const { name, email } = parseFrom(header(headers, 'From'));
    out.push({
      gmail_message_id: id,
      thread_id: data.threadId,
      sender: name,
      sender_email: email,
      subject: header(headers, 'Subject'),
      snippet: data.snippet || '',
      received_at: isoFromInternal(data.internalDate),
      is_unread: (data.labelIds || []).includes('UNREAD') ? 1 : 0,
    });
  }
  return out;
}

// One Claude call classifies the whole batch. Returns a Map index→classification.
async function classify(messages, runId = null) {
  if (!messages.length) return new Map();
  if (!process.env.ANTHROPIC_API_KEY) {
    // no key: store everything as 'normal', no deadlines/status inference
    return new Map(messages.map((_, i) => [i, { importance: 'normal', category: null, deadline: null, deadlineTitle: null, company: null, role: null, statusSignal: 'none' }]));
  }
  const list = messages.map((m, i) =>
    `[${i}] From: ${m.sender} <${m.sender_email}>\n    Subject: ${m.subject}\n    Snippet: ${m.snippet}`).join('\n\n');
  const res = await trackedCreate({
    agent: 'email', runId,
    model: MODEL,
    max_tokens: Math.min(8000, 800 + messages.length * 80),   // scale with batch (backfill scans more)
    system: `You triage a job-seeker's inbox. For each email, decide:
- importance: "urgent" (needs action today / time-sensitive), "important" (matters, not urgent), "normal", or "noise" (newsletters, promos, automated).
- category: a short freeform label (e.g. "interview", "application", "recruiter", "newsletter", "billing").
- deadline: ONLY if the email requires YOU to personally act by a specific date — an appointment, interview, application deadline, RSVP, or a bill/payment due date. An ISO 8601 datetime; else null. Do NOT treat marketing or promotional expirations as deadlines ("offer expires", "sale ends", "deal ends soon", coupons, free-credit/bonus promos, limited-time discounts) — those are null. deadlineTitle: a short title for it, else null.
- company: if this is about a JOB APPLICATION at a company, the company name; else null.
- role: if this is about a job application AND a specific job title is mentioned, that title; else null.
- statusSignal: the application movement this email implies — "applied" (you submitted / application received confirmation), "interviewing" (interview invite/scheduling), "offer", "rejected", or "none".
Respond with ONLY JSON: {"emails":[{"index":0,"importance":"...","category":"...","deadline":null,"deadlineTitle":null,"company":null,"role":null,"statusSignal":"none"}]}. Preserve every index. No markdown.`,
    messages: [{ role: 'user', content: list }],
  });
  const raw = res.content[0].text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(raw);
  return new Map((parsed.emails || []).map((e) => [e.index, e]));
}

/**
 * Run the email agent. Returns a summary object (never throws for the expected
 * degradation cases — those come back as { skipped, reason }).
 */
export async function runEmailAgent({ trigger = 'cron', scanCount, reprocess = false } = {}) {
  const status = gmailStatus();
  if (!status.ready) {
    console.log(`[email:${trigger}] skipped — ${status.reason}`);
    return { skipped: true, reason: status.reason, processed: 0 };
  }

  let gmail;
  try {
    gmail = getGmailClient();
  } catch (e) {
    return { skipped: true, reason: e.code || 'AUTH_ERROR', error: e.message, processed: 0 };
  }

  const runId = startRun('email', trigger);
  try {
  const messages = await fetchMessages(gmail, scanCount, reprocess);
  if (!messages.length) {
    console.log(`[email:${trigger}] no new messages`);
    finishRun(runId, { status: 'ok', summary: 'no new messages' });
    return { processed: 0, flagged: 0, deadlines: 0, statusUpdates: 0 };
  }

  const classifications = await classify(messages, runId);
  let flagged = 0, deadlines = 0, statusUpdates = 0, created = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const c = classifications.get(i) || { importance: 'normal', category: null, deadline: null, role: null, statusSignal: 'none' };

    // cross-agent: company + a real movement signal → flip the job's status.
    // If we have no matching job (e.g. you applied on LinkedIn, not via the
    // agent), CREATE the application from the email so it lands in the tracker.
    let relatedJobId = null;
    let actionTaken = null;
    const desiredStatus = SIGNAL_TO_STATUS[c.statusSignal];
    if (c.company && desiredStatus) {
      const job = findJobByCompany(c.company);
      if (job) {
        try {
          if (setJobStatus(job.id, desiredStatus, 'email')) {
            relatedJobId = job.id;
            actionTaken = `updated_job_status:${desiredStatus}`;
            statusUpdates += 1;
          }
        } catch (e) {
          console.error(`  [WARN] email→job status update failed (${c.company}): ${e.message}`);
        }
      } else {
        try {
          const newJob = recordEmailApplication({ company: c.company, role: c.role, status: desiredStatus, at: msg.received_at });
          if (newJob) {
            relatedJobId = newJob.id;
            actionTaken = `created_application:${desiredStatus}`;
            created += 1;
          }
        } catch (e) {
          console.error(`  [WARN] email→create application failed (${c.company}): ${e.message}`);
        }
      }
    }

    const flag = upsertFlag({
      gmail_message_id: msg.gmail_message_id,
      thread_id: msg.thread_id,
      sender: msg.sender,
      sender_email: msg.sender_email,
      subject: msg.subject,
      snippet: msg.snippet,
      received_at: msg.received_at,
      importance: ['urgent', 'important', 'normal', 'noise'].includes(c.importance) ? c.importance : 'normal',
      category: c.category || null,
      is_unread: msg.is_unread,
      deadline_at: c.deadline || null,
      related_job_id: relatedJobId,
      action_taken: actionTaken,
    });
    flagged += 1;

    // extracted deadline → calendar event linked back to this flag, but ONLY for
    // mail that actually matters. Promo/noise "offer expires" junk never makes the
    // calendar (it buried real deadlines + urgent items like payment failures).
    const promoish = c.importance === 'noise' || /promo|sale|newsletter|offer|deal|coupon|marketing|discount/i.test(c.category || '');
    if (c.deadline && !promoish) {
      addCalendarEvent({
        title: c.deadlineTitle || msg.subject || 'Deadline',
        description: `From ${msg.sender}: ${msg.subject}`,
        start_at: c.deadline,
        source_agent: 'email',
        source_ref: flag.id,
      });
      deadlines += 1;
    }
  }

  console.log(`[email:${trigger}] ${flagged} flagged · ${deadlines} deadlines · ${statusUpdates} status updates · ${created} new applications`);
    finishRun(runId, { status: 'ok', summary: `${flagged} flagged · ${deadlines} deadlines · ${statusUpdates} updated · ${created} created` });
    return { processed: messages.length, flagged, deadlines, statusUpdates, created };
  } catch (e) {
    finishRun(runId, { status: 'error', error: e.message });
    throw e;
  }
}

export { gmailStatus };
