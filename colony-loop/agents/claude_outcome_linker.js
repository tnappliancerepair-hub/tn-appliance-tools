// CLAUDE OUTCOME LINKER
//
// One agent, three signal subscriptions. Whenever an outcome signal
// fires for an entity we care about, this walks back the
// claude_call_logged events for that entity within a recency window
// and writes claude_call_outcome rows tying the calls to the
// observed outcome. Weekly digest reads both tables to compute hit
// rates per (brain, tool, signal_type) cell.
//
// Subscribed signals + outcome derivations:
//
//   JOB_COMPLETED
//     → outcome_type = "first_visit_fix" | "callback_within_30d" |
//                      "job_completed"
//     → outcome_value = "good" | "bad" | "neutral"
//     → links calls for that job_id in last 30 days
//
//   CUSTOMER_FEEDBACK_RECEIVED
//     → outcome_type = "customer_rating"
//     → outcome_value = rating string ("5", "4", "3", "2", "1")
//     → links calls for that customer_id in last 14 days
//
//   WARRANTY_CLAIM_ACTION (only when action="clear")
//     → outcome_type = "warranty_clear"
//     → outcome_value = "good"
//     → links calls for that job_id in last 7 days
//
// Architecture note: this agent doesn't care WHICH outcome triggered
// it — the dispatch convention routes JOB_COMPLETED →
// job_completed.js. We register three thin proxy agents that all
// import from this module so signal_type → filename routing still
// works.

import { listRecentEventLog, recordEvent } from '../xano.js';

const LOOKBACK_DAYS_BY_OUTCOME = {
  job_completed: 30,
  customer_feedback_received: 14,
  warranty_claim_action: 7,
};

// Side-task entry: called from existing agents (job_completed,
// customer_feedback_received, warranty_claim_action) after their own
// work. Does NOT mark the signal — the caller owns that.
export async function linkOutcomesForJob(signal, ctx, { outcomeType, outcomeValue, lookbackDays, entityKey, entityId }) {
  const { log } = ctx;

  // Pull recent claude_call_logged events scoped to this entity
  const substringFilter = `"${entityKey}":${entityId}`;
  let rows = [];
  try {
    rows = await listRecentEventLog({
      action: 'claude_call_logged',
      days_back: lookbackDays,
      limit: 200,
    });
  } catch (e) {
    if (log) log('claude_outcome_linker_query_failed', { error: String(e) });
    rows = [];
  }

  // Filter to ones mentioning the entity. Cheap substring match in JS.
  const matched = (rows || []).filter((r) => {
    const meta = typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata || {});
    return meta.includes(substringFilter);
  });

  if (matched.length === 0) {
    return { success: true, action: 'no_calls', count: 0 };
  }

  let linked = 0;
  for (const row of matched) {
    let meta;
    try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata; }
    catch (_) { meta = {}; }
    const callLogId = meta.call_log_id || 0;
    if (!callLogId) continue;
    try {
      await recordEvent('claude_call_outcome', {
        call_log_id: callLogId,
        outcome_type: outcomeType,
        outcome_value: outcomeValue,
        brain: meta.brain || '',
        signal_type_at_call: meta.signal_type || '',
        job_id: meta.job_id || 0,
        customer_id: meta.customer_id || 0,
        tech_id: meta.tech_id || 0,
        confidence_pct: meta.confidence_pct || 0,
        tool_calls_count: meta.tool_calls_count || 0,
        linked_at_ms: Date.now(),
      });
      linked += 1;
    } catch (_) {}
  }

  if (log) log('claude_outcome_linker_linked', {
    outcome: outcomeType,
    value: outcomeValue,
    calls: linked,
    entity: `${entityKey}=${entityId}`,
  });
  return { success: true, action: 'linked', count: linked };
}

// Default export run() — invoked when signal_type=claude_outcome_link
// (a dedicated test signal). Real triggers are the three proxy agents.
export async function run(signal, ctx) {
  const p = signal.payload || {};
  return linkOutcomesForJob(signal, ctx, {
    outcomeType: p.outcome_type || 'unspecified',
    outcomeValue: p.outcome_value || '',
    lookbackDays: Number(p.lookback_days || 14),
    entityKey: p.entity_key || 'job_id',
    entityId: Number(p.entity_id || 0),
  });
}
