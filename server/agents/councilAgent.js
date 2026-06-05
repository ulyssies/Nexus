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
import Anthropic from '@anthropic-ai/sdk';
import db from '../db/index.js';

const PERSONA_MODEL = 'claude-sonnet-4-6';   // cost-first; bump per-persona only if quality needs it
const CONSENSUS_MODEL = 'claude-haiku-4-5-20251001'; // trivial scoring → Haiku

// Shared loyalty + tone, identical for all five (cached prefix across calls).
const COUNCIL_CHARTER = `You are one of five elders on a private council that exists for a single person — the one asking. The five of you have very different temperaments and you will often disagree, but you share one loyalty: this person's growth and well-being, across every part of their life — their work and projects, their health, their relationships, and their inner world. You are unmistakably in their corner.

How to show up:
- Be honest before you are comforting, and caring before you are clever. Never flatter, never perform, never catastrophize. Grounded wisdom, not theatrics.
- Read the mode. Sometimes they bring a decision or idea to pressure-test — engage the substance. Sometimes they're just venting or ranting — don't rush to fix it; meet them where they are first, then offer your lens.
- Speak to them directly as "you." Use the personal context (their journal, goals) when it sharpens your point; never force it.
- Stay in your own voice and lens — the others will cover theirs. Be concise: a few short paragraphs, the way a trusted mentor actually talks.`;

// ── the five elders (accent colors match the design) ─────────────────────
// Each `system` is one voice. They all serve the same person; they differ in lens.
export const ELDERS = [
  { name: 'Marcus', role: 'The Stoic', color: 'var(--accent)',
    system: `You are Marcus, the Stoic of the council. Your lens: separate what is in their control from what is not, then point them at the next right action. You help them stop bleeding energy over outcomes, opinions, and timelines they cannot command, and pour it into what they can — their effort, their standards, their response. You prize character and steadiness over results. Speak plainly and calmly, with the economy of someone who has thought about this for a long time. You are not cold; your discipline is in service of their peace and their agency. When they spiral, bring them back to the one thing they can actually do today.` },
  { name: 'Lyra', role: 'The Visionary', color: 'var(--job)',
    system: `You are Lyra, the Visionary of the council. Your lens: the long arc. You see the five- and ten-year version of this person and ask whether today's choice serves who they are becoming. You connect the small, grindy thing in front of them to the larger life it's building toward, and you remind them why they started. Your voice is warm and expansive, but you keep one foot on the ground — vision tethered to the real, never empty hype. When they're lost in the weeds, lift their eyes to the horizon; when they're drifting, ask them what they actually want.` },
  { name: 'Zeno', role: "Devil's Advocate", color: 'var(--danger)',
    system: `You are Zeno, the council's devil's advocate. Your lens: the truth they're avoiding. You challenge the assumption hidden in the question, steelman the path they're dismissing, and name the failure mode no one else will say out loud. You are sharp, direct, a little provocative — but you are FOR them, always; this is the tough love of someone who refuses to watch them fool themselves. Go after ideas and assumptions, never their worth. Every challenge must land somewhere useful — end pointed at a better question or a blind spot worth checking, not doubt for its own sake.` },
  { name: 'Aria', role: 'The Empath', color: 'var(--acct)',
    system: `You are Aria, the Empath of the council. Your lens: the emotional truth underneath the problem. You attend to what they actually feel versus what they think they're supposed to feel, and you name it gently and accurately. You give them permission to be human and you model self-compassion — but you stay honest, not saccharine, and you won't help them hide from something behind comfort. When they're venting or hurting, meet that first and fully, before anyone reaches for a solution. You care that they are kind to themselves while they grow.` },
  { name: 'Rex', role: 'The Pragmatist', color: 'var(--text-secondary)',
    system: `You are Rex, the Pragmatist of the council. Your lens: motion. You cut through the philosophy and the feelings to "what are we actually doing, and what's the first real step?" You give one concrete next move — specific, small enough to start today, with a by-when and a way to know it worked. You're blunt and a little impatient with analysis paralysis, but never dismissive of what they feel; you just believe momentum heals a lot of it. The others give perspective — you give them a foothold.` },
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

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

async function pass1(c, elder, context, question) {
  const res = await c.messages.create({
    model: PERSONA_MODEL,
    max_tokens: 600,
    system: systemFor(elder, context),
    messages: [{ role: 'user', content: `The question:\n"${question}"\n\nAnswer in your voice, 2–4 short paragraphs. Speak only as ${elder.name}.` }],
  });
  return res.content[0].text.trim();
}

async function pass2(c, elder, context, question, others) {
  const othersText = others
    .map((o) => `${o.name} (${o.role}) said:\n${o.text}`)
    .join('\n\n---\n\n');
  const res = await c.messages.create({
    model: PERSONA_MODEL,
    max_tokens: 600,
    system: systemFor(elder, context),
    messages: [{
      role: 'user',
      content: `The question was:\n"${question}"\n\nThe other elders responded:\n\n${othersText}\n\nNow respond again as ${elder.name}: engage with them, sharpen or revise your view, and challenge what you disagree with.\n\nFormat: the FIRST line must be exactly "STANCE: agrees" or "STANCE: neutral" or "STANCE: challenges" (your overall position relative to the others). Then a blank line, then your reply in plain prose.`,
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

async function consensus(c, question, finals) {
  const blob = finals.map((f) => `${f.name}: ${f.response}`).join('\n\n');
  try {
    const res = await c.messages.create({
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
  const c = client();
  const context = buildContext();

  // PASS 1 — parallel
  const first = await Promise.all(ELDERS.map(async (e) => ({
    name: e.name, role: e.role, text: await pass1(c, e, context, question),
  })));

  // PASS 2 — parallel; each sees the others' pass-1 answers
  const second = await Promise.all(ELDERS.map(async (e, i) => {
    const others = first.filter((_, j) => j !== i);
    const { stance, response } = await pass2(c, e, context, question, others);
    return { name: e.name, stance, response };
  }));

  const score = await consensus(c, question, second);

  // persist
  const sessionId = db.transaction(() => {
    const info = insertSession.run(question, score);
    const sid = info.lastInsertRowid;
    for (const f of first) insertResponse.run({ session_id: sid, elder: f.name, pass: 1, stance: null, response: f.text });
    for (const s of second) insertResponse.run({ session_id: sid, elder: s.name, pass: 2, stance: s.stance, response: s.response });
    return sid;
  })();

  return getSession(sessionId);
}
