// Handles PARTS_INTELLIGENCE signals (emitted by any parts_lookup_*.js
// supplier agent after Claude generates its supplier-specific intel block).
//
// Two responsibilities:
//   1. Persist this supplier's response to event_log (action='parts_intel_response')
//      so parts_decision_due.js can aggregate after the window expires.
//   2. On the FIRST PARTS_INTELLIGENCE for a job, emit PARTS_DECISION_DUE
//      with a 90-second deadline. Subsequent supplier responses for the
//      same job piggyback on the already-pending DUE signal — no second
//      emit needed.
//
// Why 90s: gives the slowest supplier (Claude latency + retries) time to
// respond. Most suppliers complete in <30s in practice, so 90s captures
// the full set without making Teddy wait too long for the digest.
import { config } from '../config.js';

const DECISION_WINDOW_MS = 90 * 1000;

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'parts_intelligence_handled', {
      outcome: 'skipped_missing_job_id',
    });
    return { success: false, action: 'skipped_missing_job_id' };
  }

  const intelText = String(payload.intel_text || '').trim();
  const specialty = String(payload.specialty || '').trim();

  // 1. Persist this supplier's response. The decision agent will pull all
  //    of these via get_parts_intel_for_job after the window.
  try {
    await xano.recordEventLog('parts_intel_response', {
      job_id: jobId,
      specialty,
      specialty_display: payload.specialty_display || specialty,
      generated_by: payload.generated_by || '',
      intel_text: intelText,
      source_signal_id: signal.id,
      generated_at_ms: payload.generated_at_ms || Date.now(),
    });
  } catch (err) {
    log('parts_intel_response_persist_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // 2. If no PARTS_DECISION_DUE is already pending for this job, emit one.
  //    We detect "pending" by checking that no parts_decision_aggregated
  //    has been recorded yet (the durable end-state). Risk: a redundant
  //    DUE might fire if two suppliers respond near-simultaneously before
  //    the dedup row is written — the decision agent's own dedup absorbs
  //    that race.
  let alreadyHandled = false;
  try {
    const h = await xano.getPartsDecisionHandled(jobId);
    alreadyHandled = !!(h && h.handled);
  } catch (err) {
    log('parts_decision_handled_check_failed', { job_id: jobId, error: String(err.message || err) });
  }

  if (!alreadyHandled) {
    const deadlineMs = Date.now() + DECISION_WINDOW_MS;
    try {
      await xano.emitSignal({
        signal_type: 'PARTS_DECISION_DUE',
        signal_strength: 60,
        payload: {
          job_id: jobId,
          deadline_ms: deadlineMs,
          scheduled_for_ms: deadlineMs,
          source: 'parts_intelligence_chain',
          source_signal_id: signal.id,
        },
      });
    } catch (err) {
      log('parts_decision_due_emit_failed', { job_id: jobId, error: String(err.message || err) });
    }
  }

  const meta = {
    job_id: jobId,
    outcome: 'persisted',
    specialty,
    intel_chars: intelText.length,
    triggered_decision: !alreadyHandled,
  };
  await xano.markSignalProcessed(signal.id, 'parts_intelligence_handled', meta);
  log('parts_intelligence_handled', meta);

  return { success: true, action: 'persisted', job_id: jobId };
}
