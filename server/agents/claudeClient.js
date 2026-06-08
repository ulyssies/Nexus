// ============================================================
//  Instrumented Claude client — the single chokepoint every agent's
//  Anthropic calls flow through, so cost + usage are captured in one place.
//
//  - trackedCreate({ agent, runId, ...params }) calls messages.create, reads
//    the response usage, estimates the dollar cost from published per-model
//    rates, and logs a row to agent_usage. It returns the raw response, so
//    callers use it exactly like client.messages.create.
//  - startRun(agent, trigger) / finishRun(runId, {...}) bracket a run in
//    agent_runs so the Settings panel can show what ran, what failed, and
//    what it cost.
//
//  All logging is best-effort (try/catch): instrumentation must NEVER break
//  an agent. Cost is an ESTIMATE — exact billing needs the usage API.
// ============================================================
import Anthropic from '@anthropic-ai/sdk';
import db from '../db/index.js';

// Published Anthropic list prices, USD per MILLION tokens. Cache-write is the
// 5-minute rate. Update here if pricing changes. Unknown models fall back to
// the Sonnet rate so cost is never silently zero.
const PRICING = {
  'claude-sonnet-4-6':        { input: 3,  output: 15, cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-haiku-4-5-20251001':{ input: 1,  output: 5,  cacheWrite: 1.25,  cacheRead: 0.10 },
  'claude-opus-4-8':          { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
};
const FALLBACK = PRICING['claude-sonnet-4-6'];

let _client = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// Estimate USD for one call's usage object.
export function estimateCost(model, usage = {}) {
  const p = PRICING[model] || FALLBACK;
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  return (input * p.input + output * p.output + cacheWrite * p.cacheWrite + cacheRead * p.cacheRead) / 1e6;
}

const insertUsage = db.prepare(`
  INSERT INTO agent_usage
    (run_id, agent, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
  VALUES (@run_id, @agent, @model, @input, @output, @cacheRead, @cacheWrite, @cost)`);

function logUsage({ runId = null, agent, model, usage }) {
  try {
    insertUsage.run({
      run_id: runId, agent, model,
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      cacheWrite: usage.cache_creation_input_tokens || 0,
      cost: estimateCost(model, usage),
    });
  } catch (e) {
    console.error(`  [WARN] usage logging failed (${agent}): ${e.message}`);
  }
}

/**
 * Drop-in for client.messages.create that also records cost/usage.
 * Pass `agent` (required) and optional `runId`; the rest are normal
 * messages.create params. Returns the raw Anthropic response.
 */
export async function trackedCreate({ agent, runId = null, ...params }) {
  const res = await client().messages.create(params);
  if (res && res.usage) logUsage({ runId, agent, model: params.model, usage: res.usage });
  return res;
}

// ── run bracketing (agent_runs) ──────────────────────────────────────────────
const insertRun = db.prepare(
  "INSERT INTO agent_runs (agent, trigger, status) VALUES (?, ?, 'running')");
const updateRun = db.prepare(`
  UPDATE agent_runs SET status = @status, summary = @summary, error = @error,
         finished_at = datetime('now') WHERE id = @id`);

/** Open a run row; returns its id (or null if logging failed). */
export function startRun(agent, trigger = 'manual') {
  try { return insertRun.run(agent, trigger).lastInsertRowid; }
  catch (e) { console.error(`  [WARN] startRun failed (${agent}): ${e.message}`); return null; }
}

/** Close a run row with an outcome. No-op if runId is null. */
export function finishRun(runId, { status = 'ok', summary = null, error = null } = {}) {
  if (runId == null) return;
  try { updateRun.run({ id: runId, status, summary, error }); }
  catch (e) { console.error(`  [WARN] finishRun failed: ${e.message}`); }
}

/**
 * Convenience wrapper: run an async fn as a tracked agent run. Creates the
 * run, passes runId to the fn, and closes it ok/error automatically. The fn
 * may return { summary } to annotate the run.
 */
export async function withRun(agent, trigger, fn) {
  const runId = startRun(agent, trigger);
  try {
    const result = await fn(runId);
    finishRun(runId, { status: 'ok', summary: result && result.summary ? String(result.summary).slice(0, 300) : null });
    return result;
  } catch (e) {
    finishRun(runId, { status: 'error', error: String(e.message).slice(0, 500) });
    throw e;
  }
}
