// ============================================================
//  MORNING BRIEF AGENT — a personal daily digest.
//
//  Pipeline:
//    1. learnInterests() — top note tags + active goal categories (from the
//       shared second brain), so the digest tracks what the user cares about.
//    2. fetch news (NewsAPI /v2/everything) for those interests, last N days.
//    3. condense each article to a ~1-paragraph read with Claude (Sonnet),
//       and write a short TL;DR intro for the morning.
//    4. persist via briefRepo (one brief/day + ordered items).
//
//  Graceful degradation (matches the job/tag agents):
//    - no NEWS_API_KEY  → store an empty brief whose summary explains the gap.
//    - no ANTHROPIC key → keep the articles, use each source's own description
//      as the item summary (no AI condense). Nothing crashes.
// ============================================================
import { trackedCreate, startRun, finishRun } from './claudeClient.js';
import { effectiveInterests, saveBrief, getBrief, saveDigest } from '../db/briefRepo.js';
import { BRIEF_ARTICLE_COUNT, BRIEF_LOOKBACK_DAYS } from '../config.js';

const MODEL = 'claude-sonnet-4-6';
const DIGEST_TTL_HOURS = 6;
const today = () => new Date().toISOString().slice(0, 10);

// hours since a SQLite ('YYYY-MM-DD HH:MM:SS' UTC) / ISO timestamp
function hoursSince(ts) {
  if (!ts) return Infinity;
  const t = Date.parse(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? (Date.now() - t) / 36e5 : Infinity;
}

// Pull recent articles for the interests from NewsAPI. Returns [] on no key.
async function fetchNews(interests) {
  if (!process.env.NEWS_API_KEY) return { articles: [], reason: 'no NEWS_API_KEY' };
  // OR the interests into one query; quote multi-word terms for relevance
  const q = interests.map((t) => (t.includes(' ') ? `"${t}"` : t)).join(' OR ') || 'technology';
  const from = new Date(Date.now() - BRIEF_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const url = new URL('https://newsapi.org/v2/everything');
  url.searchParams.set('q', q);
  url.searchParams.set('from', from);
  url.searchParams.set('language', 'en');
  url.searchParams.set('sortBy', 'relevancy');
  url.searchParams.set('pageSize', String(BRIEF_ARTICLE_COUNT * 2)); // over-fetch, filter empties
  url.searchParams.set('apiKey', process.env.NEWS_API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`NewsAPI ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const articles = (data.articles || [])
    .filter((a) => a.title && a.url && !/\[removed\]/i.test(a.title))
    .slice(0, BRIEF_ARTICLE_COUNT)
    .map((a) => ({
      headline: a.title,
      source_url: a.url,
      description: a.description || a.content || '',
      source: a.source?.name || '',
    }));
  return { articles, reason: null };
}

// Condense the fetched articles + write a TL;DR intro. Falls back to raw
// descriptions (and a templated intro) when no Anthropic key is present.
async function condense(interests, articles, runId = null) {
  const fallbackIntro = articles.length
    ? `${articles.length} stories today across ${interests.slice(0, 3).join(', ') || 'your interests'}.`
    : 'No fresh stories matched your interests today.';
  if (!process.env.ANTHROPIC_API_KEY || !articles.length) {
    return {
      summary: fallbackIntro,
      items: articles.map((a) => ({
        headline: a.headline, source_url: a.source_url,
        summary: a.description || null, topic: interests[0] || null,
      })),
    };
  }

  try {
    const list = articles.map((a, i) =>
      `[${i}] ${a.headline}\n    ${a.description}\n    (source: ${a.source})`).join('\n\n');
    const res = await trackedCreate({
      agent: 'brief', runId,
      model: MODEL,
      max_tokens: 1200,
      system: `You are a personal morning-brief editor. The reader cares about: ${interests.join(', ') || 'technology, career'}. For each article you're given, write a tight 2–3 sentence digest in plain English — what happened and why it matters to someone with those interests. Also write a one-sentence TL;DR for the whole morning. Respond with ONLY JSON: {"summary": "the TL;DR", "items": [{"index": 0, "digest": "...", "topic": "which interest it maps to"}]}. Keep every article; preserve indices; no markdown.`,
      messages: [{ role: 'user', content: `Articles:\n\n${list}` }],
    });
    const raw = res.content[0].text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);
    const byIndex = new Map((parsed.items || []).map((it) => [it.index, it]));
    return {
      summary: String(parsed.summary || fallbackIntro).trim(),
      items: articles.map((a, i) => {
        const ai = byIndex.get(i);
        return {
          headline: a.headline,
          source_url: a.source_url,
          summary: ai?.digest?.trim() || a.description || null,
          topic: ai?.topic?.trim() || interests[0] || null,
        };
      }),
    };
  } catch (e) {
    console.error(`  [WARN] morning brief condense failed: ${e.message}`);
    return {
      summary: fallbackIntro,
      items: articles.map((a) => ({ headline: a.headline, source_url: a.source_url, summary: a.description || null, topic: interests[0] || null })),
    };
  }
}

/**
 * Build (and persist) today's brief. Never throws — on a hard error it still
 * writes a brief whose summary explains what went wrong, so the home view is
 * never blank. Returns the persisted brief.
 */
export async function runMorningBrief({ trigger = 'cron' } = {}) {
  const date = today();
  const interests = effectiveInterests();
  const runId = startRun('brief', trigger);
  try {
    const { articles, reason } = await fetchNews(interests);
    if (reason === 'no NEWS_API_KEY') {
      const brief = saveBrief({
        brief_date: date,
        summary: 'Morning brief is configured but needs a NEWS_API_KEY in server/.env (free at newsapi.org) to curate stories.',
        items: [],
      });
      console.log(`[brief:${trigger}] skipped — no NEWS_API_KEY`);
      finishRun(runId, { status: 'skipped', summary: 'no NEWS_API_KEY' });
      return brief;
    }
    const { summary, items } = await condense(interests, articles, runId);
    const brief = saveBrief({ brief_date: date, summary, items });
    console.log(`[brief:${trigger}] curated ${items.length} stories for: ${interests.join(', ') || '(no interests yet)'}`);
    finishRun(runId, { status: 'ok', summary: `curated ${items.length} stories · interests: ${interests.join(', ') || 'none'}` });
    return brief;
  } catch (e) {
    console.error(`[brief:${trigger}] failed: ${e.message}`);
    finishRun(runId, { status: 'error', error: e.message });
    return saveBrief({ brief_date: date, summary: `Couldn't build the brief today: ${e.message}`, items: [] });
  }
}

/**
 * The home-screen digest: a substantive daily read grouped under bold topic
 * headers (**AI & Engineering**, **Career**, **Learning**), 2–4 concrete sentences
 * per story with an actionable angle. Depth over brevity (the card scrolls).
 * Cached on the brief row — Claude is only called when there's no digest, the
 * cached one is stale (> DIGEST_TTL_HOURS), or `force` is set. Never throws:
 * falls back to the brief's own TL;DR summary.
 *
 * Returns { digest, digestAt, hasBriefToday, itemCount, generated, stale }.
 */
export async function buildDigest({ force = false } = {}) {
  const brief = getBrief();                    // latest brief
  const date = today();
  if (!brief || brief.brief_date !== date) {
    return { digest: null, digestAt: null, hasBriefToday: false, itemCount: 0, generated: false, stale: true };
  }
  const items = brief.items || [];
  const fresh = brief.digest && hoursSince(brief.digest_at) < DIGEST_TTL_HOURS;
  if (fresh && !force) {
    return { digest: brief.digest, digestAt: brief.digest_at, hasBriefToday: true, itemCount: items.length, generated: false, stale: false };
  }

  // No stories (or no key) — the digest is just the brief's intro line.
  if (!items.length || !process.env.ANTHROPIC_API_KEY) {
    const text = brief.summary || 'No fresh stories matched your interests today.';
    const saved = saveDigest(brief.id, text);
    return { digest: text, digestAt: saved.digest_at, hasBriefToday: true, itemCount: items.length, generated: true, stale: false };
  }

  const interests = effectiveInterests();
  const runId = startRun('brief', force ? 'manual' : 'on-demand');
  try {
    const stories = items.map((it, i) =>
      `[${i + 1}] (${it.topic || 'general'}) ${it.headline}\n    ${it.summary || ''}`).join('\n\n');
    // Prompt optimizes for: a SUBSTANTIVE daily read (not a skim) — bold
    // topic-section headers (AI&Eng / Career / Learning), 2-4 concrete sentences
    // per story with specifics + an actionable angle. Depth over brevity; the
    // card scrolls. No metaphors, no essay "throughline" conclusions.
    const res = await trackedCreate({
      agent: 'brief', runId,
      model: MODEL,
      max_tokens: 1024,
      system: `You are writing a personal morning brief the reader sits down to read with coffee — they want depth and specifics, not a skim. Their interests: AI, software/data engineering, landing an entry-level SWE/DA job right now, and learning/self-improvement.
Structure the brief under bold topic headers — **AI & Engineering**, **Career**, **Learning** — including a header only when you have real material for it, and put each section on its own line separated by a blank line. Under each header, cover every story that has a genuine angle for that area; for each, write 2–4 sentences with concrete specifics (names, numbers, what is actually new), why it matters to someone with these interests, and any way they could act on it. Find a real, useful angle for as many of today's stories as you honestly can — skip only ones with no genuine connection to AI, engineering, career, or learning. Be specific and substantive (concrete facts beat vague framing) and plain-spoken: NO metaphors, NO essay-style "throughline"/"woven through" conclusions, NO closing summary. Use markdown bold for the headers only.`,
      messages: [{ role: 'user', content: `Today's stories:\n\n${stories}` }],
    });
    const text = String(res.content[0].text || '').trim() || brief.summary || '';
    const saved = saveDigest(brief.id, text);
    finishRun(runId, { status: 'ok', summary: `digest synthesized from ${items.length} stories` });
    return { digest: text, digestAt: saved.digest_at, hasBriefToday: true, itemCount: items.length, generated: true, stale: false };
  } catch (e) {
    console.error(`  [WARN] brief digest failed: ${e.message}`);
    finishRun(runId, { status: 'error', error: e.message });
    const text = brief.summary || 'Couldn’t synthesize the digest just now.';
    const saved = saveDigest(brief.id, text);
    return { digest: text, digestAt: saved.digest_at, hasBriefToday: true, itemCount: items.length, generated: true, stale: true };
  }
}

export { getBrief };
