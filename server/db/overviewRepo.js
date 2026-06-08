// ============================================================
//  Overview — the home dashboard's one-shot read.
//
//  The whole point of Nexus is that every agent writes to the same DB, so
//  the home screen can show ONE cross-agent picture: top-line stats, a live
//  status line per agent, and a merged activity feed pulled from every
//  agent's table. This is read-only and defensive (each source is wrapped so
//  an empty/young table never breaks the dashboard).
// ============================================================
import { CronExpressionParser } from 'cron-parser';
import db from './index.js';
import { gmailStatus } from '../agents/emailAgent.js';
import { JOB_AGENT_CRON, ACCOUNTABILITY_CRON, ARCHIVIST_CRON, BRIEF_CRON, EMAIL_CRON } from '../config.js';

const n = (sql, ...a) => { try { return db.prepare(sql).get(...a).n; } catch { return 0; } };
const r1 = (sql, ...a) => { try { return db.prepare(sql).get(...a); } catch { return null; } };
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
    { key: 'acct', name: 'Accountability', view: 'goals',
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
// Per-source caps scale with `limit` so the home view can show a full, scrollable
// history (archivist tends to dominate; the UI collapses it behind a toggle).
function feed(limit = 8) {
  const items = [];
  const cap = Math.max(6, limit);

  for (const r of rows("SELECT summary, changed_at, project_name FROM project_changes ORDER BY changed_at DESC, id DESC LIMIT ?", cap)) {
    items.push({ agent: 'project', text: `${r.project_name}: ${r.summary}`, at: r.changed_at });
  }
  for (const r of rows("SELECT question, consensus_score, created_at FROM council_sessions ORDER BY created_at DESC LIMIT ?", Math.ceil(cap / 3))) {
    items.push({ agent: 'council', text: `Council weighed in: “${String(r.question).slice(0, 70)}”${r.consensus_score != null ? ` (consensus ${r.consensus_score})` : ''}`, at: r.created_at });
  }
  for (const r of rows("SELECT company, status, status_updated_by, status_updated_at FROM jobs WHERE status_updated_at IS NOT NULL AND status != 'new' ORDER BY status_updated_at DESC LIMIT ?", Math.ceil(cap / 2))) {
    items.push({ agent: r.status_updated_by === 'email' ? 'email' : 'job', text: `${r.company} → ${r.status}${r.status_updated_by === 'email' ? ' (by email agent)' : ''}`, at: r.status_updated_at });
  }
  for (const r of rows("SELECT subject, sender, importance, action_taken, COALESCE(received_at, created_at) at FROM email_flags WHERE importance IN ('urgent','important') OR action_taken IS NOT NULL ORDER BY at DESC LIMIT ?", Math.ceil(cap / 2))) {
    const lead = r.action_taken ? 'updated job board' : `flagged ${r.importance}`;
    items.push({ agent: 'email', text: `Email agent ${lead}: ${String(r.subject || '(no subject)').slice(0, 60)}`, at: r.at });
  }
  for (const r of rows("SELECT c.status, c.checkin_date, c.created_at, g.title FROM checkins c JOIN goals g ON g.id = c.goal_id ORDER BY c.created_at DESC LIMIT ?", Math.ceil(cap / 2))) {
    items.push({ agent: 'acct', text: `Checked in: ${r.title} — ${r.status}`, at: r.created_at });
  }
  for (const r of rows("SELECT brief_date, generated_at, (SELECT COUNT(*) FROM morning_brief_items i WHERE i.brief_id = m.id) c FROM morning_brief m ORDER BY brief_date DESC LIMIT 3")) {
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

// ============================================================
//  /api/home — the daily command center. Answers, in one read:
//  what's urgent (alerts), what's on today (agenda), what's the system
//  saying (brief digest + agent health), and what happened (feed).
// ============================================================

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

// Short, human "when" label from a timestamp, relative to local midnight.
function dueLabel(ts) {
  const t = epoch(ts);
  if (!t) return '';
  const days = Math.round((t - startOfToday()) / 86_400_000);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 7) return `in ${days} days`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const SOURCE_LABEL = { email: 'email agent', user: 'manual', job: 'job agent', accountability: 'accountability' };

// ── Zone 1: alert strip — only time-sensitive, actionable items ──────────────
function alerts() {
  const out = [];

  // calendar events / extracted deadlines within the next 7 days
  for (const e of rows(`
    SELECT id, title, start_at, source_agent FROM calendar_events
     WHERE start_at >= datetime('now','-12 hours') AND start_at <= datetime('now','+7 days')
     ORDER BY start_at ASC LIMIT 6`)) {
    out.push({ text: `${e.title} ${dueLabel(e.start_at)}`, agent: e.source_agent === 'email' ? 'email' : 'job', view: 'calendar', at: e.start_at });
  }
  // goals with no check-in logged yet today
  for (const g of rows(`
    SELECT g.title FROM goals g
     WHERE g.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.goal_id = g.id AND c.checkin_date = date('now'))
     ORDER BY g.created_at DESC LIMIT 4`)) {
    out.push({ text: `${g.title} check-in due today`, agent: 'acct', view: 'goals', at: null });
  }
  // urgent unread emails (one rolled-up alert)
  const urgent = n("SELECT COUNT(*) n FROM email_flags WHERE importance = 'urgent'");
  if (urgent) out.push({ text: `${urgent} urgent email${urgent === 1 ? '' : 's'}`, agent: 'email', view: 'calendar', at: null });

  return out.slice(0, 8);
}

// ── Zone 2: today's agenda — goals (with today's status), calendar, deadlines ─
function agenda() {
  // active goals + today's check-in status + streak
  const goals = rows(`
    SELECT g.id, g.title, g.category, g.cadence,
           c.status AS checkin_status,
           COALESCE(s.current_count, 0) AS streak
      FROM goals g
      LEFT JOIN checkins c ON c.goal_id = g.id AND c.checkin_date = date('now')
      LEFT JOIN streaks  s ON s.goal_id = g.id
     WHERE g.status = 'active'
     ORDER BY g.created_at DESC`).map((g) => ({
    id: g.id,
    title: g.title,
    category: g.category,
    cadence: g.cadence,
    streak: g.streak,
    // done / missed if a check-in exists for today, otherwise it's still due
    status: g.checkin_status === 'missed' ? 'missed' : g.checkin_status ? 'done' : 'due',
  }));

  const calendar = rows(`
    SELECT id, title, start_at, all_day, source_agent FROM calendar_events
     WHERE date(start_at) = date('now')
     ORDER BY all_day DESC, start_at ASC LIMIT 12`).map((e) => ({
    id: e.id, title: e.title, start_at: e.start_at, all_day: e.all_day,
    source: SOURCE_LABEL[e.source_agent] || e.source_agent,
  }));

  const jobDeadlines = rows(`
    SELECT id, title, start_at FROM calendar_events
     WHERE source_agent = 'job' AND start_at >= datetime('now','-12 hours')
       AND start_at <= datetime('now','+7 days')
     ORDER BY start_at ASC LIMIT 8`).map((e) => ({ id: e.id, title: e.title, start_at: e.start_at, due: dueLabel(e.start_at) }));

  return { goals, calendar, jobDeadlines };
}

// ── Zone 5: agent health — last/next run + one real insight line per agent ───
const HEALTH = [
  { key: 'job',     runKey: 'job',            name: 'Job agent',         view: 'jobs',           cron: JOB_AGENT_CRON },
  { key: 'email',   runKey: 'email',          name: 'Email agent',       view: 'calendar',       cron: EMAIL_CRON },
  { key: 'council', runKey: 'council',        name: 'Council of 5',      view: 'council',         cron: null },
  { key: 'acct',    runKey: 'accountability', name: 'Accountability',    view: 'goals', cron: ACCOUNTABILITY_CRON },
  { key: 'news',    runKey: 'brief',          name: 'Morning brief',     view: 'home',           cron: BRIEF_CRON },
  { key: 'project', runKey: 'archivist',      name: 'Project archivist', view: 'projects',       cron: ARCHIVIST_CRON },
];

function nextRun(cron) {
  if (!cron) return null;
  try { return CronExpressionParser.parse(cron, { tz: 'UTC' }).next().toISOString(); }
  catch { return null; }
}

const lastRunOf = (agent) => r1(
  'SELECT trigger, status, summary, error, started_at, finished_at FROM agent_runs WHERE agent = ? ORDER BY id DESC LIMIT 1', agent);

function insightFor(key) {
  switch (key) {
    case 'job': {
      const tracked = n('SELECT COUNT(*) n FROM jobs');
      const fresh = n("SELECT COUNT(*) n FROM jobs WHERE created_at >= datetime('now','-1 day')");
      return `${tracked} tracked${fresh ? ` · ${fresh} new since yesterday` : ''}`;
    }
    case 'email': {
      const urgent = n("SELECT COUNT(*) n FROM email_flags WHERE importance = 'urgent'");
      const next = r1("SELECT title, deadline_at FROM email_flags WHERE deadline_at >= datetime('now','-12 hours') ORDER BY deadline_at ASC LIMIT 1");
      const dl = next ? ` · ${String(next.title || 'deadline').slice(0, 22)} ${dueLabel(next.deadline_at)}` : '';
      return gmailStatus().ready ? `${urgent} urgent${dl}` : 'needs gmail authorization';
    }
    case 'council': {
      const s = n('SELECT COUNT(*) n FROM council_sessions');
      return s ? `${s} session${s === 1 ? '' : 's'} · ready` : 'ready to consult';
    }
    case 'acct': {
      const due = n(`SELECT COUNT(*) n FROM goals g WHERE g.status='active'
        AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.goal_id=g.id AND c.checkin_date=date('now'))`);
      const best = n('SELECT COALESCE(MAX(current_count),0) n FROM streaks');
      return `${due} due today · best streak ${best}`;
    }
    case 'news': {
      const items = n("SELECT COUNT(*) n FROM morning_brief_items WHERE brief_id = (SELECT id FROM morning_brief ORDER BY brief_date DESC LIMIT 1)");
      const hasDigest = !!r1("SELECT 1 a FROM morning_brief WHERE brief_date = date('now') AND digest IS NOT NULL");
      return items ? `${items} stories · ${hasDigest ? 'digest ready' : 'no digest yet'}` : 'no brief yet today';
    }
    case 'project': {
      const changes = n('SELECT COUNT(*) n FROM project_changes');
      const repos = n('SELECT COUNT(DISTINCT project_name) n FROM project_changes');
      return `${changes} change${changes === 1 ? '' : 's'} · watching ${repos} repo${repos === 1 ? '' : 's'}`;
    }
    default: return '';
  }
}

function agentHealth() {
  const gmailReady = gmailStatus().ready;
  const goalsDueToday = n(`SELECT COUNT(*) n FROM goals g WHERE g.status='active'
    AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.goal_id=g.id AND c.checkin_date=date('now'))`);
  return HEALTH.map((a) => {
    const last = lastRunOf(a.runKey);
    let dot = a.cron ? 'active' : 'idle';
    if (a.key === 'acct' && goalsDueToday > 0) dot = 'attention'; // a pending check-in nudges
    if (a.key === 'email' && !gmailReady) dot = 'warn';
    if (last?.status === 'error') dot = 'warn';                   // a real failure wins
    return {
      key: a.key, name: a.name, view: a.view, dot,
      insight: insightFor(a.key),
      lastRun: last ? (last.finished_at || last.started_at) : null,
      lastStatus: last?.status || null,
      nextRun: nextRun(a.cron),
    };
  });
}

export function getHome() {
  const brief = r1("SELECT id, brief_date, summary, digest, digest_at, generated_at FROM morning_brief WHERE brief_date = date('now')");
  const items = brief ? rows('SELECT id, headline, source_url, summary, topic FROM morning_brief_items WHERE brief_id = ? ORDER BY position', brief.id) : [];
  const stale = !brief?.digest_at || (Date.now() - epoch(brief.digest_at)) / 36e5 >= 6;
  return {
    stats: stats(),
    alerts: alerts(),
    agenda: agenda(),
    agents: agentHealth(),
    feed: feed(40),
    brief: {
      hasBriefToday: !!brief,
      summary: brief?.summary || null,
      digest: brief?.digest || null,
      digestAt: brief?.digest_at || null,
      stale,
      itemCount: items.length,
      items,
    },
  };
}
