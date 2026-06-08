// ============================================================
//  COUNCIL OF 5 — on-demand multi-persona reasoning.
//
//  Mechanism (this file = the plumbing, verified working):
//    1. Build shared context from recent journal entries + active goals.
//    2. PASS 1 — 5 personas answer the question in parallel.
//    3. PASS 2 — each persona sees the other four and responds again,
//       declaring a stance (agrees | neutral | challenges).
//    4. CONSENSUS — a cheap 6th call scores alignment 0–100.
//    5. Persist the session + every response to SQLite.
//
//  The shared context is sent as a cached system block (identical prefix
//  across all five persona calls) so prompt caching cuts cost.
//
//  The five persona prompts below are a working first draft, shaped around
//  one principle: every elder is devoted to the user's growth — they just
//  bring a different lens, and they care about all of it (work, projects,
//  health, inner life). COUNCIL_CHARTER holds the shared loyalty + tone;
//  each `system` holds one voice. Tune these over time as the voices settle.
// ============================================================
import { trackedCreate, startRun, finishRun } from './claudeClient.js';
import db from '../db/index.js';

const PERSONA_MODEL = 'claude-sonnet-4-6';   // cost-first; bump per-persona only if quality needs it
const CONSENSUS_MODEL = 'claude-haiku-4-5-20251001'; // trivial scoring → Haiku

// Shared loyalty + tone, identical for all five (cached prefix across calls).
const COUNCIL_CHARTER = `You are one of five elders on a private council that exists for one person — the one asking. You have very different temperaments and you will often disagree, but you share one loyalty: this person's growth and well-being, across all of it — work, projects, health, relationships, and their inner world. You are unmistakably, warmly in their corner. You are not a chatbot; you are someone who knows them and wants the best for them.

How to show up:
- Be honest before you are comforting, and warm before you are clever. Never flatter, never perform, never catastrophize. Real care, plainly spoken.
- Read the mode. A decision or idea to pressure-test → engage the substance. Venting or ranting → meet them there first, and fully, before anyone reaches for a fix.
- GROUND IT IN THEIR LIFE. You're given their recent journal and active goals — use them. Quote or paraphrase a specific entry or goal back to them when it sharpens your point. Advice that could apply to anyone is a failure; speak to THIS person and what they actually wrote.
- Be tight. Three to five sentences. No preamble, no "great question," no restating what they said — the way a sharp mentor actually talks. Stay in your own lane; the others cover theirs.`;

// ── the five elders (accent colors match the design) ─────────────────────
// Each `system` is one voice. They all serve the same person; they differ in lens.
export const ELDERS = [
  { name: 'Marcus', role: 'The Stoic', color: 'var(--accent)',
    system: `You are Marcus, the Stoic. Your lens: what is in their control versus what is not, then the next right action. You help them stop bleeding energy over outcomes and opinions they can't command and pour it into what they can — their effort, their standards, their response. Calm, plain, economical; warm underneath the discipline — your steadiness is in service of their peace, not coldness. When they spiral, name the one thing they can actually do today and hand it to them.` },
  { name: 'Lyra', role: 'The Visionary', color: 'var(--job)',
    system: `You are Lyra, the Visionary. Your lens: the long arc. You hold the five- and ten-year version of them and ask whether today's choice serves who they're becoming. You tie the grindy thing in front of them to the life it's building toward, and remind them why they started — warm and expansive, but tethered to the real, never empty hype. When they're lost in the weeds, lift their eyes; when they're drifting, ask plainly what they actually want.` },
  { name: 'Zeno', role: "Devil's Advocate", color: 'var(--danger)',
    system: `You are Zeno, the council's devil's advocate — the one who says the thing the others are being too kind to say. Find the assumption buried in their question and pull it into the light. Name the failure mode, the convenient story they're telling themselves, the line in their own journal that contradicts what they just claimed to want. Be sharp and a little uncomfortable; that discomfort is the gift. But you are FOR them, fiercely — you go after the idea, never their worth, and every challenge lands somewhere useful: a better question, a blind spot worth checking. If you haven't made them pause, you haven't done your job.` },
  { name: 'Aria', role: 'The Empath', color: 'var(--acct)',
    system: `You are Aria, the Empath. Your lens: the emotional truth under the problem — what they actually feel versus what they think they're supposed to feel. Name it gently and accurately, often straight from their own words. You give them permission to be human and you model self-compassion, but you stay honest, never saccharine, and you won't help them hide behind comfort. When they're hurting or venting, meet that first and fully. You care that they're kind to themselves while they grow.` },
  { name: 'Rex', role: 'The Pragmatist', color: 'var(--text-secondary)',
    system: `You are Rex, the Pragmatist. Your lens: motion. Cut through the philosophy and the feelings to "what are we actually doing, and what's the first real step?" Give ONE concrete next move — specific, startable today, with a by-when and a way to know it worked. Blunt, a little impatient with analysis paralysis, but never dismissive of what they feel; you just believe momentum heals a lot of it. The others give perspective — you give them a foothold.` },
];

const STANCES = new Set(['agrees', 'neutral', 'challenges']);

// ── shared context (cached prefix across all persona calls) ───────────────
function buildContext() {
  const journal = db.prepare(
    "SELECT body, created_at FROM notes WHERE kind = 'journal' ORDER BY created_at DESC LIMIT 6"
  ).all();
  let goals = [];
  try {
    goals = db.prepare("SELECT title, target, cadence FROM goals WHERE status = 'active' ORDER BY created_at DESC LIMIT 10").all();
  } catch { /* goals feature may be empty */ }

  const journalText = journal.length
    ? journal.map((j) => `- (${j.created_at}) ${j.body}`).join('\n')
    : '(no recent journal entries)';
  const goalsText = goals.length
    ? goals.map((g) => `- ${g.title}${g.target ? ` — target ${g.target}` : ''}${g.cadence ? ` (${g.cadence})` : ''}`).join('\n')
    : '(no active goals recorded)';

  return `PERSONAL CONTEXT (shared, for grounding your advice — reference it when relevant):\n\nRecent journal entries:\n${journalText}\n\nActive goals:\n${goalsText}`;
}

// system blocks: [ cached shared-context, persona voice ] — the first block
// is identical across all five elders, so it's a shared cacheable prefix.
function systemFor(elder, context) {
  return [
    // shared charter + personal context = identical prefix across all 5 elders → cached
    { type: 'text', text: `${COUNCIL_CHARTER}\n\n${context}`, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: elder.system },
  ];
}

async function pass1(elder, context, question, runId) {
  const res = await trackedCreate({
      agent: 'council', runId,
    model: PERSONA_MODEL,
    max_tokens: 600,
    system: systemFor(elder, context),
    messages: [{ role: 'user', content: `The question:\n"${question}"\n\nAnswer in your voice — tight, 3–5 sentences, grounded in their journal/goals where it sharpens the point. No preamble. Speak only as ${elder.name}.` }],
  });
  return res.content[0].text.trim();
}

async function pass2(elder, context, question, others, runId) {
  const othersText = others
    .map((o) => `${o.name} (${o.role}) said:\n${o.text}`)
    .join('\n\n---\n\n');
  const res = await trackedCreate({
      agent: 'council', runId,
    model: PERSONA_MODEL,
    max_tokens: 600,
    system: systemFor(elder, context),
    messages: [{
      role: 'user',
      content: `The question was:\n"${question}"\n\nThe other elders responded:\n\n${othersText}\n\nNow respond again as ${elder.name}: engage with them, sharpen or revise your view, and challenge what you disagree with. Keep it tight — 3–5 sentences.\n\nFormat: the FIRST line must be exactly "STANCE: agrees" or "STANCE: neutral" or "STANCE: challenges" (your overall position relative to the others). Then a blank line, then your reply in plain prose.`,
    }],
  });
  // Robust parse: stance from the first line, prose is everything after.
  // Free text needs no escaping this way (unlike JSON).
  const raw = res.content[0].text.trim();
  const m = raw.match(/STANCE:\s*(agrees|neutral|challenges)/i);
  const stance = m && STANCES.has(m[1].toLowerCase()) ? m[1].toLowerCase() : 'neutral';
  const response = raw.replace(/^[\s\S]*?STANCE:\s*(?:agrees|neutral|challenges)\s*/i, '').trim() || raw;
  return { stance, response };
}

async function consensus(question, finals, runId) {
  const blob = finals.map((f) => `${f.name}: ${f.response}`).join('\n\n');
  try {
    const res = await trackedCreate({
      agent: 'council', runId,
      model: CONSENSUS_MODEL,
      max_tokens: 10,
      messages: [{ role: 'user', content: `Five advisors answered the question "${question}". Rate how much they AGREE with each other overall, 0 (total conflict) to 100 (full consensus). Reply with ONLY the integer.\n\n${blob}` }],
    });
    const n = parseInt(res.content[0].text.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
  } catch {
    return null;
  }
}

// ── persistence ───────────────────────────────────────────────────────────
const insertSession = db.prepare('INSERT INTO council_sessions (question, consensus_score) VALUES (?, ?)');
const insertResponse = db.prepare(
  'INSERT INTO council_responses (session_id, elder, pass, stance, response) VALUES (@session_id, @elder, @pass, @stance, @response)'
);

export function getSession(id) {
  const session = db.prepare('SELECT * FROM council_sessions WHERE id = ?').get(id);
  if (!session) return null;
  const responses = db.prepare('SELECT elder, pass, stance, response FROM council_responses WHERE session_id = ? ORDER BY pass, id').all(id);
  return { ...session, responses };
}

export function listSessions(limit = 20) {
  return db.prepare('SELECT id, question, consensus_score, created_at FROM council_sessions ORDER BY created_at DESC LIMIT ?').all(limit);
}

/**
 * Run the full council on a question. Returns the persisted session.
 * Throws { code: 'NO_API_KEY' } if the key is missing (graceful upstream).
 */
export async function askCouncil(question) {
  if (!question || !String(question).trim()) throw new Error('A question is required');
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY is not set in server/.env');
    e.code = 'NO_API_KEY';
    throw e;
  }
  const runId = startRun('council', 'on-demand');
  try {
    const context = buildContext();

    // PASS 1 — parallel
    const first = await Promise.all(ELDERS.map(async (e) => ({
      name: e.name, role: e.role, text: await pass1(e, context, question, runId),
    })));

    // PASS 2 — parallel; each sees the others' pass-1 answers
    const second = await Promise.all(ELDERS.map(async (e, i) => {
      const others = first.filter((_, j) => j !== i);
      const { stance, response } = await pass2(e, context, question, others, runId);
      return { name: e.name, stance, response };
    }));

    const score = await consensus(question, second, runId);

    // persist
    const sessionId = db.transaction(() => {
      const info = insertSession.run(question, score);
      const sid = info.lastInsertRowid;
      for (const f of first) insertResponse.run({ session_id: sid, elder: f.name, pass: 1, stance: null, response: f.text });
      for (const s of second) insertResponse.run({ session_id: sid, elder: s.name, pass: 2, stance: s.stance, response: s.response });
      return sid;
    })();

    finishRun(runId, { status: 'ok', summary: `5 elders + consensus ${score ?? '—'} · "${String(question).slice(0, 60)}"` });
    return getSession(sessionId);
  } catch (e) {
    finishRun(runId, { status: 'error', error: e.message });
    throw e;
  }
}
