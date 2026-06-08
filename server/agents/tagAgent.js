// ============================================================
//  TAG AGENT — auto-tags a note so the second-brain graph self-organizes.
//
//  Given a note's text, Claude returns 2–4 short topic tags. Existing tags
//  are passed in and the model is told to reuse them when they fit — that
//  reuse is what links notes in the graph (shared tag = edge). Degrades
//  gracefully with no API key (returns []), exactly like the job agent, so
//  the journal still saves; tags simply stay empty until a key is set.
// ============================================================
import { trackedCreate } from './claudeClient.js';

const MODEL = 'claude-sonnet-4-6'; // light classification — Sonnet, not Opus
const clean = (s) => String(s).trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, ' ').trim();

/**
 * Extract tags for a note. `existingTags` biases the model toward reuse.
 * Returns { tags: string[], skipped?: bool, error?: string } — never throws.
 */
export async function tagNote({ body, title = '' }, existingTags = [], { runId = null } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return { tags: [], skipped: true };
  const text = `${title ? title + '\n' : ''}${body}`.slice(0, 6000);

  try {
    const existing = existingTags.length
      ? `\n\nExisting tags in the user's second brain (REUSE these when they fit, only invent a new one when none apply):\n${existingTags.join(', ')}`
      : '';
    const response = await trackedCreate({
      agent: 'tag', runId,
      model: MODEL,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Extract 2–4 short topic tags for this note. Tags are lowercase, 1–2 words, no '#'. They organize a personal knowledge graph, so prefer broad reusable themes (e.g. career, health, projects, learning) over hyper-specific phrases.${existing}\n\nReturn ONLY a JSON array of strings, nothing else.\n\nNOTE:\n${text}`,
      }],
    });
    const raw = response.content[0].text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);
    const tags = [...new Set((Array.isArray(parsed) ? parsed : []).map(clean).filter(Boolean))].slice(0, 5);
    return { tags };
  } catch (e) {
    console.error(`  [WARN] tag agent failed: ${e.message}`);
    return { tags: [], error: e.message };
  }
}
