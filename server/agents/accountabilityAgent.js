// ============================================================
//  ACCOUNTABILITY AGENT — the council member that keeps score.
//
//  Two jobs, both cheap and local (only Anthropic, no third-party API):
//
//   1. nudge()      — on-demand + nightly: builds ONE warm, streak-aware
//                     check-in message for the goals not yet logged today.
//                     Reads goals + their streaks + recent journal for tone.
//                     Sonnet (cost-first); degrades to a templated message
//                     with no API key, so the view always shows something.
//
//   2. rollover()   — nightly cron: recomputes every active goal's cached
//                     streak from its check-in history. This is what makes a
//                     *missed* day reset current_count even though no row is
//                     written — recomputeStreak() anchors the live streak to
//                     "within one cadence period of today", so a silent gap
//                     correctly breaks it. No phantom 'missed' rows are
//                     inserted (that would wrongly punish a not-yet-logged day).
//
//  The nightly message is intentionally not persisted — it's a live prompt,
//  regenerated whenever the user opens the view. (A future phase can email it
//  or, like the council, store sessions; v1 keeps it ephemeral and cheap.)
// ============================================================
import Anthropic from '@anthropic-ai/sdk';
import db from '../db/index.js';
import { listGoals, goalsNeedingCheckin, recomputeStreak } from '../db/goalsRepo.js';

const MODEL = 'claude-sonnet-4-6'; // tone + judgement, but routine → Sonnet, not Opus

const SYSTEM = `You are the accountability voice of a personal AI system — a steady, encouraging coach who has watched this person work toward their goals. You are warm but never saccharine, and you are honest: you celebrate real streaks and you name a slip without shaming it. You speak directly to the person as "you", briefly (3–5 sentences total for the whole message, not per goal). You are nudging them to check in on the goals they haven't logged today. Reference their streaks specifically when it helps motivate ("you're 11 days into the gym — don't break it tonight"). Close with a small, concrete ask. No headers, no markdown, no lists — just a short human paragraph.`;

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Recent journal entries give the nudge emotional context (matches council).
function recentJournal(limit = 4) {
  try {
    return db.prepare(
      "SELECT body FROM notes WHERE kind = 'journal' ORDER BY created_at DESC LIMIT ?"
    ).all(limit).map((r) => r.body);
  } catch { return []; }
}

// A no-API-key fallback so the Accountability view is never blank.
function templateNudge(pending) {
  if (!pending.length) return "All your goals are checked in for today. Nice work — rest is part of the plan.";
  const names = pending.map((g) => g.title).join(', ');
  return `You still have ${pending.length} goal${pending.length > 1 ? 's' : ''} to log today: ${names}. Take a minute to check in — even a "partial" keeps the streak honest.`;
}

/**
 * Build the daily check-in nudge for goals not yet logged on `date`.
 * Returns { message, pending: goalsNeedingCheckin, source: 'ai'|'template' }.
 * Never throws — falls back to a template on missing key or API error.
 */
export async function nudge(date) {
  const pending = goalsNeedingCheckin(date);
  if (!process.env.ANTHROPIC_API_KEY) {
    return { message: templateNudge(pending), pending, source: 'template' };
  }
  if (!pending.length) {
    return { message: "Everything's checked in for today. That's the whole game — showing up. Rest well.", pending, source: 'template' };
  }

  // pull each pending goal's cached streak so the coach can be specific
  const withStreaks = listGoals({ status: 'active' }).filter((g) => pending.some((p) => p.id === g.id));
  const goalsText = withStreaks.map((g) => {
    const s = g.streak || {};
    return `- "${g.title}"${g.target ? ` (target ${g.target})` : ''}, cadence ${g.cadence}: current streak ${s.current_count || 0}, longest ${s.longest_count || 0}`;
  }).join('\n');
  const journal = recentJournal();
  const journalText = journal.length ? `\n\nRecent journal (for tone, reference only if it helps):\n${journal.map((j) => `- ${j}`).join('\n')}` : '';

  try {
    const res = await client().messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Goals not yet checked in today:\n${goalsText}${journalText}\n\nWrite the nudge.`,
      }],
    });
    return { message: res.content[0].text.trim(), pending, source: 'ai' };
  } catch (e) {
    console.error(`  [WARN] accountability nudge failed: ${e.message}`);
    return { message: templateNudge(pending), pending, source: 'template', error: e.message };
  }
}

/**
 * Nightly cache refresh: recompute every active goal's streak so silent misses
 * reset the live count. Returns the number of goals refreshed. Pure local — no
 * API call, safe to run unattended on the cron with no key configured.
 */
export function rollover() {
  const goals = db.prepare("SELECT id FROM goals WHERE status = 'active'").all();
  for (const g of goals) recomputeStreak(g.id);
  return { refreshed: goals.length };
}

/** Convenience for the cron: refresh streaks, then build (and log) the nudge. */
export async function runAccountability({ trigger = 'cron' } = {}) {
  const { refreshed } = rollover();
  const { message, pending, source } = await nudge();
  console.log(`[accountability:${trigger}] refreshed ${refreshed} streaks, ${pending.length} pending (${source})`);
  return { refreshed, pending, message, source };
}
