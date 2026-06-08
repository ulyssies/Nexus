// ============================================================
//  Seed the second brain with a realistic concept hierarchy + tagged
//  child nodes, so the graph view has a HEALTHY shape to demo: directed
//  parent→child edges (the Phase 9 hierarchy) crossing the flat shared-tag
//  edges the tagging agent produces.
//
//  Idempotent: every seeded node is stamped source_agent='seed'; re-running
//  skips if seeds already exist. Pass --reset to delete prior seeds first.
//  The owner intends to wipe these once real notes accumulate.
//
//  Usage:  node scripts/seed-second-brain.js          (seed if empty)
//          node scripts/seed-second-brain.js --reset   (clear seeds, re-seed)
// ============================================================
import db from '../db/index.js';
import { createNote, setNoteTags } from '../db/notesRepo.js';

const reset = process.argv.includes('--reset');

if (reset) {
  const del = db.prepare("DELETE FROM notes WHERE source_agent = 'seed'").run();
  console.log(`[seed] cleared ${del.changes} prior seed node(s)`);
}

const existing = db.prepare("SELECT COUNT(*) n FROM notes WHERE source_agent = 'seed'").get().n;
if (existing > 0) {
  console.log(`[seed] ${existing} seed nodes already present — nothing to do (use --reset to rebuild).`);
  process.exit(0);
}

// concept (organizational anchor) → directed parent edges
function concept(title, parent_id = null) {
  const note = createNote({
    title, body: title, kind: 'note', node_type: 'concept',
    is_concept: 1, parent_id, source_agent: 'seed',
  });
  return note.id;
}

// a leaf knowledge node filed under a concept, with shared tags (tag edges)
const KIND_FOR = { journal: 'journal', research: 'note', note: 'note', archivist: 'project' };
function node(title, body, node_type, parent_id, tags) {
  const note = createNote({
    title, body, kind: KIND_FOR[node_type] || 'note', node_type,
    parent_id, source_agent: 'seed',
  });
  setNoteTags(note.id, tags);
  return note.id;
}

const tx = db.transaction(() => {
  // ── Career ────────────────────────────────────────────────────────────────
  const career = concept('Career');
  node('First week applying to SWE roles',
    'Sent out 12 applications this week. The Adzuna + Muse pipeline surfaced a few strong matches; tracking responses in the job board.',
    'journal', career, ['career', 'job-search', 'swe']);
  node('What hiring managers look for in senior engineers',
    'Researched signals beyond raw coding: scope of ownership, communication, mentoring, and judgment under ambiguity. Ownership came up everywhere.',
    'research', career, ['career', 'hiring', 'interview-prep']);
  node('Résumé v3 — quantified impact',
    'Rewrote bullets to lead with measurable outcomes. Cut the skills wall; let projects carry the signal.',
    'note', career, ['career', 'resume']);

  //   Interview Prep nested under Career
  const interview = concept('Interview Prep', career);
  node('System design fundamentals',
    'Worked through load balancing, caching layers, and DB sharding. Practiced framing tradeoffs out loud before jumping to a design.',
    'research', interview, ['interview-prep', 'system-design', 'swe']);
  node('Behavioral STAR stories',
    'Drafted six STAR stories mapped to ownership, conflict, and failure. Reused the second-brain project notes as raw material.',
    'note', interview, ['interview-prep', 'behavioral']);

  // ── AI & ML ─────────────────────────────────────────────────────────────────
  const ai = concept('AI & ML');
  node('Reasoning-model efficiency findings',
    'New work on getting comparable reasoning quality at lower token cost — relevant to keeping agent runs cheap. Caching + smaller models for routing.',
    'research', ai, ['ai', 'llm', 'research']);
  node('Thoughts on agent architectures',
    'A shared context layer beats isolated agents. The value is cross-agent writes — an email flipping a job status is the whole thesis.',
    'journal', ai, ['ai', 'agents', 'nexus']);
  node('Prompt-caching cost patterns',
    'Caching the résumé / charter / journal prefix is the single biggest cost lever. Measured it in the Settings panel after wiring telemetry.',
    'research', ai, ['ai', 'llm', 'cost']);

  // ── Nexus Project ────────────────────────────────────────────────────────────
  const nexus = concept('Nexus Project');
  node('Job board upgrade shipped',
    'Inline AI detail panels, status tracking, lifetime seen-set, boot catch-up. Descriptions no longer truncated at 250 chars.',
    'archivist', nexus, ['nexus', 'project', 'jobs']);
  node('Why I am building a second brain',
    'Not a feature — the nervous system. Every agent reads and writes the same notes, goals, and journal, so they can act on each other.',
    'journal', nexus, ['nexus', 'project', 'second-brain']);
  node('Phase 10 ideas',
    'Calendar month grid, quantified goals + reminders, email draft suggestions (never auto-send), résumé/cover-letter drafts.',
    'note', nexus, ['nexus', 'project', 'roadmap']);

  // ── Health & Discipline ──────────────────────────────────────────────────────
  const health = concept('Health & Discipline');
  node('Gym streak — day 1',
    'Restarted the daily gym goal. Accountability agent logged the check-in; streak at 1 and the nightly nudge is live.',
    'journal', health, ['health', 'gym', 'discipline']);
  node('Sleep experiment',
    'Testing a fixed wake time for two weeks. Hypothesis: consistent mornings make the brief + check-in routine actually stick.',
    'note', health, ['health', 'sleep', 'discipline']);
});

tx();

const counts = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM notes WHERE source_agent='seed') nodes,
    (SELECT COUNT(*) FROM notes WHERE source_agent='seed' AND is_concept=1) concepts,
    (SELECT COUNT(*) FROM note_tags nt JOIN notes n ON n.id=nt.note_id WHERE n.source_agent='seed') tag_links
`).get();
console.log(`[seed] created ${counts.nodes} nodes (${counts.concepts} concepts) with ${counts.tag_links} tag links.`);
console.log('[seed] done — open the Second brain view to see the hierarchy + tag graph.');
