// ============================================================
//  Overview — the home dashboard's one-shot read.
//
//  The whole point of Nexus is that every agent writes to the same DB, so
//  the home screen can show ONE cross-agent picture: top-line stats, a live
//  status line per agent, and a merged activity feed pulled from every
//  agent's table. This is read-only and defensive (each source is wrapped so
//  an empty/young table never breaks the dashboard).
// ============================================================
import db from './index.js';
import { gmailStatus } from '../agents/emailAgent.js';

const n = (sql, ...a) => { try { return db.prepare(sql).get(...a).n; } catch { return 0; } };
const rows = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch { return []; } };

// normalize SQLite timestamps ('YYYY-MM-DD HH:MM:SS' UTC) + ISO into epoch ms.
function epoch(ts) {
  if (!ts) return 0;
  const s = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

// ── top-line stats (the four cards) ──────────────────────────────────────────
function stats() {
  return {
    jobsTracked: n('SELECT COUNT(*) n FROM jobs'),
    strongMatches: n('SELECT COUNT(*) n FROM jobs WHERE match_score >= 75'),
    urgentEmails: n("SELECT COUNT(*) n FROM email_flags WHERE importance = 'urgent'"),
    bestStreak: n('SELECT COALESCE(MAX(current_count),0) n FROM streaks'),
    upcomingDeadlines: n("SELECT COUNT(*) n FROM calendar_events WHERE start_at >= datetime('now','-1 day')"),
    activeGoals: n("SELECT COUNT(*) n FROM goals WHERE status = 'active'"),
  };
}

// ── per-agent status line (drives the AGENTS panel) ──────────────────────────
function agents() {
  const jobs = n('SELECT COUNT(*) n FROM jobs');
  const flagsTotal = n('SELECT COUNT(*) n FROM email_flags');
  const urgent = n("SELECT COUNT(*) n FROM email_flags WHERE importance = 'urgent'");
  const sessions = n('SELECT COUNT(*) n FROM council_sessions');
  const activeGoals = n("SELECT COUNT(*) n FROM goals WHERE status = 'active'");
  const best = n('SELECT COALESCE(MAX(current_count),0) n FROM streaks');
  const briefItems = n("SELECT COUNT(*) n FROM morning_brief_items WHERE brief_id = (SELECT id FROM morning_brief ORDER BY brief_date DESC LIMIT 1)");
  const projects = n('SELECT COUNT(DISTINCT project_name) n FROM project_changes');
  const changes = n('SELECT COUNT(*) n FROM project_changes');
  const gmail = gmailStatus();

  return [
    { key: 'job', name: 'Job agent', view: 'jobs', dot: 'active',
      sub: `${jobs} listing${jobs === 1 ? '' : 's'} tracked` },
    { key: 'email', name: 'Email agent', view: 'calendar',
      dot: gmail.ready ? 'active' : 'warn',
      sub: gmail.ready ? `${flagsTotal} triaged · ${urgent} urgent` : 'needs gmail authorization' },
    { key: 'council', name: 'Council of 5', view: 'council', dot: 'idle',
      sub: sessions ? `${sessions} session${sessions === 1 ? '' : 's'} · ready` : 'ready to consult' },
    { key: 'acct', name: 'Accountability', view: 'accountability',
      dot: activeGoals ? 'active' : 'warn',
      sub: activeGoals ? `${activeGoals} goal${activeGoals === 1 ? '' : 's'} · best streak ${best}` : 'no goals yet · check-in 8pm' },
    { key: 'news', name: 'Morning brief', view: 'home',
      dot: briefItems ? 'active' : 'warn',
      sub: briefItems ? `${briefItems} stories · ready` : 'no brief yet today' },
    { key: 'project', name: 'Project archivist', view: 'projects', dot: 'active',
      sub: `watching ${projects} repo${projects === 1 ? '' : 's'} · ${changes} change${changes === 1 ? '' : 's'}` },
  ];
}

// ── merged cross-agent activity feed ─────────────────────────────────────────
function feed(limit = 8) {
  const items = [];

  for (const r of rows("SELECT summary, changed_at, project_name FROM project_changes ORDER BY changed_at DESC, id DESC LIMIT 6")) {
    items.push({ agent: 'project', text: `${r.project_name}: ${r.summary}`, at: r.changed_at });
  }
  for (const r of rows("SELECT question, consensus_score, created_at FROM council_sessions ORDER BY created_at DESC LIMIT 4")) {
    items.push({ agent: 'council', text: `Council weighed in: “${String(r.question).slice(0, 70)}”${r.consensus_score != null ? ` (consensus ${r.consensus_score})` : ''}`, at: r.created_at });
  }
  for (const r of rows("SELECT company, status, status_updated_by, status_updated_at FROM jobs WHERE status_updated_at IS NOT NULL AND status != 'new' ORDER BY status_updated_at DESC LIMIT 5")) {
    items.push({ agent: r.status_updated_by === 'email' ? 'email' : 'job', text: `${r.company} → ${r.status}${r.status_updated_by === 'email' ? ' (by email agent)' : ''}`, at: r.status_updated_at });
  }
  for (const r of rows("SELECT subject, sender, importance, action_taken, COALESCE(received_at, created_at) at FROM email_flags WHERE importance IN ('urgent','important') OR action_taken IS NOT NULL ORDER BY at DESC LIMIT 5")) {
    const lead = r.action_taken ? 'updated job board' : `flagged ${r.importance}`;
    items.push({ agent: 'email', text: `Email agent ${lead}: ${String(r.subject || '(no subject)').slice(0, 60)}`, at: r.at });
  }
  for (const r of rows("SELECT c.status, c.checkin_date, c.created_at, g.title FROM checkins c JOIN goals g ON g.id = c.goal_id ORDER BY c.created_at DESC LIMIT 4")) {
    items.push({ agent: 'acct', text: `Checked in: ${r.title} — ${r.status}`, at: r.created_at });
  }
  for (const r of rows("SELECT brief_date, generated_at, (SELECT COUNT(*) FROM morning_brief_items i WHERE i.brief_id = m.id) c FROM morning_brief m ORDER BY brief_date DESC LIMIT 2")) {
    if (r.c) items.push({ agent: 'news', text: `Morning brief curated ${r.c} stories`, at: r.generated_at });
  }

  return items
    .filter((i) => i.at)
    .sort((a, b) => epoch(b.at) - epoch(a.at))
    .slice(0, limit);
}

export function getOverview() {
  return { stats: stats(), agents: agents(), feed: feed() };
}
