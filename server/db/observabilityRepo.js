// ============================================================
//  Observability read layer — powers the Settings panel.
//
//  Surfaces, from agent_runs + agent_usage: each agent's last run (when /
//  trigger / status / summary), recent errors, the next scheduled run per
//  cron-driven agent, and cost rollups (today, total, per-agent, daily trend).
//  Cost is the ESTIMATE recorded at call time (published rates).
// ============================================================
import { CronExpressionParser } from 'cron-parser';
import db from './index.js';
import { JOB_AGENT_CRON, ACCOUNTABILITY_CRON, ARCHIVIST_CRON, BRIEF_CRON, EMAIL_CRON } from '../config.js';

// All agents we report on, with their cron (null = on-demand) and a label.
const AGENTS = [
  { key: 'job',            label: 'Job agent',         cron: JOB_AGENT_CRON },
  { key: 'email',          label: 'Email agent',       cron: EMAIL_CRON },
  { key: 'council',        label: 'Council of 5',      cron: null },
  { key: 'accountability', label: 'Accountability',    cron: ACCOUNTABILITY_CRON },
  { key: 'brief',          label: 'Morning brief',     cron: BRIEF_CRON },
  { key: 'archivist',      label: 'Project archivist', cron: ARCHIVIST_CRON },
  { key: 'tag',            label: 'Tagging agent',     cron: null },
];

const r1 = (sql, ...a) => { try { return db.prepare(sql).get(...a); } catch { return null; } };
const rows = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch { return []; } };

function nextRun(cron) {
  if (!cron) return null;
  try { return CronExpressionParser.parse(cron, { tz: 'UTC' }).next().toISOString(); }
  catch { return null; }
}

const lastRunStmt = db.prepare(
  'SELECT trigger, status, summary, error, started_at, finished_at FROM agent_runs WHERE agent = ? ORDER BY id DESC LIMIT 1');
const agentCostStmt = db.prepare(`
  SELECT COALESCE(SUM(cost_usd),0) total,
         COALESCE(SUM(CASE WHEN date(created_at)=date('now') THEN cost_usd ELSE 0 END),0) today
    FROM agent_usage WHERE agent = ?`);

export function getObservability() {
  // per-agent card: last run + next run + cost
  const agents = AGENTS.map((a) => {
    const last = lastRunStmt.get(a.key) || null;
    const cost = agentCostStmt.get(a.key) || { total: 0, today: 0 };
    return {
      key: a.key,
      label: a.label,
      cron: a.cron,
      lastRun: last,
      nextRun: nextRun(a.cron),
      costTotal: cost.total,
      costToday: cost.today,
    };
  });

  // recent errors across all agents
  const errors = rows(
    "SELECT agent, error, trigger, started_at FROM agent_runs WHERE status = 'error' ORDER BY id DESC LIMIT 20");

  // cost rollups
  const today = r1("SELECT COALESCE(SUM(cost_usd),0) n FROM agent_usage WHERE date(created_at)=date('now')")?.n || 0;
  const total = r1('SELECT COALESCE(SUM(cost_usd),0) n FROM agent_usage')?.n || 0;
  const calls = r1('SELECT COUNT(*) n FROM agent_usage')?.n || 0;
  const daily = rows(`
    SELECT date(created_at) day, ROUND(SUM(cost_usd), 4) cost, COUNT(*) calls
      FROM agent_usage GROUP BY day ORDER BY day DESC LIMIT 14`);

  return {
    agents,
    errors,
    cost: { today, total, calls, daily },
  };
}
