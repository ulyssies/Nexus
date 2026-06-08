// ============================================================
//  RESEARCH AGENT — a chat-based research partner whose sessions distill
//  into permanent second-brain nodes.
//
//   chat()        — converse over the session history (Sonnet). The raw
//                   conversation is ephemeral working memory.
//   addSource()   — bring material in: pasted text, or a fetched URL
//                   (native fetch → stripped to plain text).
//   saveSession() — read the WHOLE conversation and condense it into one
//                   structured knowledge node (topic, summary, key concepts,
//                   conclusions, open questions, sources) saved to the graph.
//
//  Cost is tracked through the shared instrumented client (agent='research');
//  the distillation is bracketed as a run. Needs an Anthropic key (it's a
//  reasoning agent) — without one, chat/save return a clear coded error.
// ============================================================
import { trackedCreate, withRun } from './claudeClient.js';
import { addMessage, getMessages, getSession, saveResearchNode } from '../db/researchRepo.js';

const MODEL = 'claude-sonnet-4-6';
const noKey = () => { const e = new Error('ANTHROPIC_API_KEY is not set in server/.env'); e.code = 'NO_API_KEY'; return e; };

const CHAT_SYSTEM = `You are a sharp research partner inside a personal knowledge system. The user is exploring a topic — answer their questions, analyze articles or notes they paste in, and push the thinking forward with substance. Be concrete and concise; prefer clarity over length. Think in terms of concepts, conclusions, and the questions still open — this conversation will later be distilled into a permanent knowledge node, so help surface what actually matters. When they share a SOURCE, engage with its specifics, not generalities.`;

// Map the stored conversation to Anthropic messages (assistant stays assistant;
// user + source both become user turns, sources clearly marked).
function toMessages(rows) {
  return rows.map((m) => m.role === 'assistant'
    ? { role: 'assistant', content: m.content }
    : { role: 'user', content: m.role === 'source' ? `[SOURCE]\n${m.content}` : m.content });
}

/** One conversational turn. Stores the user message + the assistant reply. */
export async function chat(sessionId, userMessage) {
  if (!getSession(sessionId)) throw new Error(`session ${sessionId} not found`);
  if (!process.env.ANTHROPIC_API_KEY) throw noKey();
  if (userMessage && String(userMessage).trim()) addMessage(sessionId, { role: 'user', content: String(userMessage).trim() });

  const history = toMessages(getMessages(sessionId));
  const res = await trackedCreate({
    agent: 'research',
    model: MODEL,
    max_tokens: 1200,
    system: CHAT_SYSTEM,
    messages: history.length ? history : [{ role: 'user', content: 'Help me start researching this topic.' }],
  });
  const reply = res.content[0].text.trim();
  return addMessage(sessionId, { role: 'assistant', content: reply });
}

// crude but effective HTML → text for fetched articles
function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return { title: title ? title.trim() : null, text };
}

/** Fetch a URL and return its readable text (truncated). Throws on failure. */
export async function fetchUrl(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Nexus-Research/1.0' } });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const { title, text } = htmlToText(await res.text());
    return { title, text: text.slice(0, 12000), url };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Add a source to the session: pasted `text`, or fetch a `url`. Stored as a
 * 'source' message (with the URL/title in meta). Returns the stored message.
 */
export async function addSource(sessionId, { text = null, url = null }) {
  if (!getSession(sessionId)) throw new Error(`session ${sessionId} not found`);
  if (url) {
    const fetched = await fetchUrl(url);
    const header = `${fetched.title ? fetched.title + ' — ' : ''}${url}`;
    return addMessage(sessionId, { role: 'source', content: `${header}\n\n${fetched.text}`, meta: { url, title: fetched.title } });
  }
  if (text && String(text).trim()) {
    return addMessage(sessionId, { role: 'source', content: String(text).trim(), meta: { kind: 'pasted' } });
  }
  throw new Error('a source needs either text or a url');
}

const DISTILL_SYSTEM = `You distill a research conversation into one permanent knowledge node for the user's second brain. Read the whole conversation (including any SOURCE blocks) and extract what actually mattered. Respond with ONLY JSON, no markdown:
{
  "topic": "short title for this node",
  "summary": "one tight paragraph: what was learned",
  "keyConcepts": ["3-6 short lowercase tags — the concepts this is about"],
  "conclusions": ["the takeaways / decisions reached"],
  "openQuestions": ["questions that came up but were NOT answered"],
  "sources": ["articles, URLs, or references that were used"]
}
Be faithful to the conversation; do not invent sources or conclusions that weren't there. If a field has nothing, use an empty array (or a short summary).`;

/**
 * Distill the whole session into a structured knowledge node and persist it.
 * Returns the saved node. Bracketed as a tracked 'research' run.
 */
export async function saveSession(sessionId, { parent_id = null } = {}) {
  const session = getSession(sessionId);
  if (!session) throw new Error(`session ${sessionId} not found`);
  if (!process.env.ANTHROPIC_API_KEY) throw noKey();
  const rows = getMessages(sessionId);
  if (!rows.length) throw new Error('nothing to save — the session is empty');

  return withRun('research', 'on-demand', async (runId) => {
    const transcript = rows.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    const res = await trackedCreate({
      agent: 'research', runId,
      model: MODEL,
      max_tokens: 1500,
      system: DISTILL_SYSTEM,
      messages: [{ role: 'user', content: `Conversation to distill:\n\n${transcript}` }],
    });
    let structured;
    try {
      structured = JSON.parse(res.content[0].text.replace(/```json|```/g, '').trim());
    } catch (e) {
      throw new Error(`could not parse the distilled node: ${e.message}`);
    }
    structured.topic = structured.topic || session.topic || 'Research note';
    structured.parent_id = parent_id;
    const node = saveResearchNode(sessionId, structured);
    return { ...node, summary: `distilled "${structured.topic}" · ${(structured.keyConcepts || []).length} concepts · ${(structured.openQuestions || []).length} open questions` };
  });
}
