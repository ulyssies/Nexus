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
import { effectiveInterests, listInterests, saveBrief, getBrief, saveDigest } from '../db/briefRepo.js';
import { BRIEF_ARTICLE_COUNT, BRIEF_LOOKBACK_DAYS } from '../config.js';

const MODEL = 'claude-sonnet-4-6';
const DIGEST_TTL_HOURS = 6;
const PER_TOPIC = 6;        // articles to pull per topic query before merge/dedupe
const ENRICH_MAX = 12;      // cap on article-body fetches per run (bounds time/cost)
const today = () => new Date().toISOString().slice(0, 10);

// Strong, multi-synonym NewsAPI queries behind common topic labels. A single
// word like "ai" or "learning" matches off-topic junk; these expansions (keyed
// by lowercased label) make each Settings tag search like a real news section.
// Unknown user tags fall back to the tag itself (quoted if multi-word).
const QUERY_EXPANSIONS = {
  'artificial intelligence': '"artificial intelligence" OR "machine learning" OR "AI agents" OR "large language model" OR LLM OR Anthropic OR OpenAI OR "generative AI"',
  'ai': '"artificial intelligence" OR "machine learning" OR "AI agents" OR "large language model" OR LLM OR Anthropic OR OpenAI',
  'machine learning': '"machine learning" OR "deep learning" OR "neural network" OR "model training" OR "AI research"',
  'software engineering': '"software engineering" OR "software development" OR "developer tools" OR "open source" OR programming OR "GitHub"',
  'software development': '"software development" OR "developer tools" OR programming OR "open source" OR "software engineering"',
  'data engineering': '"data engineering" OR "data pipeline" OR "data science" OR SQL OR "analytics engineering" OR "big data"',
  'data science': '"data science" OR "data engineering" OR analytics OR "machine learning" OR "big data"',
  'tech jobs': '"software engineer hiring" OR "tech jobs" OR "entry level software" OR "developer hiring" OR "tech layoffs" OR "new grad engineer"',
  'startups': 'startup OR "Y Combinator" OR "venture capital" OR "seed funding" OR "tech founder" OR "series A"',
  'big tech': 'Google OR Apple OR Microsoft OR Amazon OR Meta OR Nvidia OR "big tech"',
  'cybersecurity': 'cybersecurity OR "data breach" OR ransomware OR hacking OR "security vulnerability"',
  'technology': 'technology OR gadgets OR software OR hardware OR "consumer tech"',
  'science': 'science OR research OR physics OR biology OR "scientific study"',
  'space': 'NASA OR SpaceX OR "space mission" OR astronomy OR rocket OR satellite',
  'learning': '"learn to code" OR "online courses" OR "study techniques" OR "skill development" OR "self improvement"',
  'productivity': 'productivity OR "time management" OR "deep work" OR "habit building" OR "focus techniques"',
  'business': 'business OR economy OR markets OR "earnings report" OR "stock market"',
  'world news': '"world news" OR international OR geopolitics OR diplomacy',
};

// Fallback topics if the user has somehow cleared every tag — keeps the brief
// from going empty. Mirrors the owner's profile (CLAUDE.md).
const FALLBACK_TOPICS = [
  { label: 'Artificial Intelligence', query: QUERY_EXPANSIONS['artificial intelligence'] },
  { label: 'Software Engineering', query: QUERY_EXPANSIONS['software engineering'] },
  { label: 'Tech Jobs', query: QUERY_EXPANSIONS['tech jobs'] },
  { label: 'Learning', query: QUERY_EXPANSIONS['learning'] },
];

// The brief's news topics ARE the active Settings tags (the user's visible,
// editable priority list) — each becomes one labeled, well-formed query via
// QUERY_EXPANSIONS. Auto-learned note tags no longer drive the search (they
// produced the off-topic results); they only feed the writer as soft context.
function buildTopics() {
  let active = [];
  try {
    active = listInterests().filter((i) => i.active).map((i) => i.label);
  } catch { /* table may be empty */ }
  if (!active.length) return FALLBACK_TOPICS;
  return active.map((label) => {
    const key = label.toLowerCase().trim();
    const query = QUERY_EXPANSIONS[key] || (label.includes(' ') ? `"${label}"` : label);
    return { label, query };
  });
}

// hours since a SQLite ('YYYY-MM-DD HH:MM:SS' UTC) / ISO timestamp
function hoursSince(ts) {
  if (!ts) return Infinity;
  const t = Date.parse(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? (Date.now() - t) / 36e5 : Infinity;
}

// Fetch one topic's recent articles. NewsAPI's free tier truncates content, so
// we only use this for headline/description/url; the real body is pulled later
// by enrichArticles(). searchIn=title,description keeps matches on-topic instead
// of matching a query term buried anywhere in the body.
async function fetchTopic(topic, from) {
  const url = new URL('https://newsapi.org/v2/everything');
  url.searchParams.set('q', topic.query);
  url.searchParams.set('from', from);
  url.searchParams.set('language', 'en');
  url.searchParams.set('searchIn', 'title,description');
  url.searchParams.set('sortBy', 'publishedAt');
  url.searchParams.set('pageSize', String(PER_TOPIC));
  url.searchParams.set('apiKey', process.env.NEWS_API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`NewsAPI ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.articles || [])
    .filter((a) => a.title && a.url && !/\[removed\]/i.test(a.title))
    .map((a) => ({
      headline: a.title,
      source_url: a.url,
      description: a.description || a.content || '',
      source: a.source?.name || '',
      topic: topic.label,             // label comes from the matching query
    }));
}

// Best-effort fetch of an article's real body text (dependency-free): grab the
// page HTML, strip script/style, pull <p> text, collapse whitespace. Many news
// sites return usable HTML; on a block/timeout/thin result we just fall back to
// the NewsAPI description, so this can only ever improve the digest.
async function fetchArticleBody(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return '';
    const html = await res.text();
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ');
    const paras = [...stripped.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim())
      .filter((s) => s.length > 40);                  // drop nav/caption fragments
    return paras.join('\n').slice(0, 2000);           // ~2k chars is plenty to condense from
  } catch { return ''; }
}

// Run every topic query, merge + dedupe (by URL and normalized title), then
// enrich the top candidates with real article bodies. Returns the strongest
// BRIEF_ARTICLE_COUNT articles, preferring ones we got real content for.
async function fetchNews() {
  if (!process.env.NEWS_API_KEY) return { articles: [], reason: 'no NEWS_API_KEY' };
  const from = new Date(Date.now() - BRIEF_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const topics = buildTopics();

  const results = await Promise.allSettled(topics.map((t) => fetchTopic(t, from)));
  const ok = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
  if (!ok.length) {
    const firstErr = results.find((r) => r.status === 'rejected');
    if (firstErr) throw new Error(firstErr.reason?.message || 'NewsAPI fetch failed');
    return { articles: [], reason: null };
  }

  // dedupe, keeping first-seen (preserves topic round order)
  const seen = new Set();
  const merged = [];
  for (const a of ok) {
    const key = a.source_url.split('?')[0] + '|' + a.headline.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(a);
  }

  // enrich the top candidates with real body text (bounded, parallel)
  const candidates = merged.slice(0, ENRICH_MAX);
  await Promise.all(candidates.map(async (a) => { a.body = await fetchArticleBody(a.source_url); }));

  // prefer articles we got real content for; keep the rest as fallback
  const withBody = candidates.filter((a) => a.body && a.body.length > 200);
  const withoutBody = candidates.filter((a) => !a.body || a.body.length <= 200);
  const articles = [...withBody, ...withoutBody].slice(0, BRIEF_ARTICLE_COUNT);
  return { articles, reason: null };
}

// Condense each article into a content-grounded 3–4 sentence read + a TL;DR
// intro. Each article keeps the label of the query that found it (so labels
// always match the story); Claude writes the digest from the real article body
// when we have it. Falls back to raw descriptions when no Anthropic key.
async function condense(interests, articles, runId = null) {
  const fallbackIntro = articles.length
    ? `${articles.length} stories today across ${[...new Set(articles.map((a) => a.topic))].slice(0, 3).join(', ')}.`
    : 'No fresh stories matched your interests today.';
  if (!process.env.ANTHROPIC_API_KEY || !articles.length) {
    return {
      summary: fallbackIntro,
      items: articles.map((a) => ({
        headline: a.headline, source_url: a.source_url,
        summary: a.description || null, topic: a.topic || null,
      })),
    };
  }

  try {
    // Feed the real body (falling back to the description) so the digest reflects
    // what the article actually says, not a one-line blurb.
    const list = articles.map((a, i) => {
      const content = (a.body && a.body.length > 200) ? a.body : (a.description || '(no preview available)');
      return `[${i}] ${a.headline}  —  topic: ${a.topic}  (source: ${a.source})\n${content}`;
    }).join('\n\n---\n\n');
    const res = await trackedCreate({
      agent: 'brief', runId,
      model: MODEL,
      max_tokens: 8000,
      system: `You are a personal morning-brief editor whose job is to make the reader actually UNDERSTAND each story, not skim it. The reader works on: ${interests.join(', ') || 'AI, software/data engineering, landing an entry-level SWE/DA job, learning'}.
For each article, write a thorough, self-contained explainer — as long as the substance genuinely needs (a few sentences for a simple item, a full paragraph or two for something new, technical, or obscure). Prioritize substance over brevity; do NOT artificially shorten.
Structure each one to teach: (1) if the topic, technology, term, company, or person is likely unfamiliar, first explain in plain language what it actually IS and the background needed to follow it; (2) then the specific facts from this article (who, what, numbers, what is new); (3) then why it matters to this reader and how they might use or act on it.
Use your own general knowledge to fill in background and context the article assumes, BUT do not invent specific facts or claims about THIS particular story that aren't in the provided text. Plain English, no metaphors, no hype, no filler.
Also write a one-sentence TL;DR for the whole morning. Respond with ONLY JSON: {"summary": "the TL;DR", "items": [{"index": 0, "digest": "..."}]}. Keep every article; preserve indices; no markdown inside the digest text.`,
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
          topic: a.topic || null,         // keep the query-derived label — it always matches
        };
      }),
    };
  } catch (e) {
    console.error(`  [WARN] morning brief condense failed: ${e.message}`);
    return {
      summary: fallbackIntro,
      items: articles.map((a) => ({ headline: a.headline, source_url: a.source_url, summary: a.description || null, topic: a.topic || null })),
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
    const { articles, reason } = await fetchNews();
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
    // Prompt optimizes for a SUBSTANTIVE daily read that TEACHES — bold
    // topic-section headers, and for each story enough depth to actually
    // understand it (what an unfamiliar term/tech IS, the context, why it
    // matters, how to act). Substance over brevity; the card scrolls, so length
    // follows the material — never artificially shortened. No metaphors/essay.
    const res = await trackedCreate({
      agent: 'brief', runId,
      model: MODEL,
      max_tokens: 6000,
      system: `You are writing a personal morning brief whose goal is to make the reader actually LEARN each story, not skim it. Their interests: AI, software/data engineering, landing an entry-level SWE/DA job right now, and learning/self-improvement.
Group the stories under bold topic headers that match the topic labels shown in parentheses with each story (e.g. **Artificial Intelligence**, **Tech Jobs**, **Startups**, **Cybersecurity**) — include a header only when you have at least one real story for it, put each section on its own line separated by a blank line, and within a header give each story its own paragraph.
For each story, go into real depth — as much as the substance needs (don't artificially shorten; the card scrolls). If the topic, technology, term, company, or person is new or obscure, FIRST explain in plain language what it actually is and the background needed to follow it, THEN the concrete specifics from the story (names, numbers, what is new), THEN why it matters to this reader and how they could use or act on it. Use your own general knowledge to supply background and context the story assumes, but don't invent specific facts about the story itself. Be specific and substantive (concrete facts beat vague framing) and plain-spoken: NO metaphors, NO essay-style "throughline"/"woven through" conclusions, NO closing summary. Use markdown bold for the headers only.`,
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
