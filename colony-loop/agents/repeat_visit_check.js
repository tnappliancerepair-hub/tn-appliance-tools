// Handles REPEAT_VISIT_CHECK signals (emitted by job_created.js after the
// initial greeting + prediag chain). Queries prior jobs for the same
// customer + appliance_type within 12 months. If ≥2 prior jobs exist,
// SMSes Teddy a callback-risk alert with the prior job IDs and emits a
// REPEAT_VISIT_FLAGGED signal for any downstream listeners (e.g. a future
// callback_root_cause agent).
//
// Why ≥2 (not ≥3): a fourth visit means the prior three attempts didn't
// fix it. Catching at attempt #3 lets Teddy escalate BEFORE the truck rolls.
import { toOwner } from '../sms.js';

const PRIOR_VISIT_THRESHOLD = 2;
const MONTHS_WINDOW = 12;

function applianceLabel(raw) {
  return String(raw || '').trim() || 'appliance';
}

function customerLabel(payload) {
  const first = (payload.customer_first_name || '').trim();
  const last  = (payload.customer_last_name || '').trim();
  return [first, last].filter(Boolean).join(' ') || '(no name)';
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const customerId = Number(payload.customer_id);
  const applianceType = String(payload.appliance_type || '').trim();

  if (!jobId || !customerId || !applianceType) {
    const meta = { job_id: jobId, outcome: 'skipped_missing_payload' };
    await xano.markSignalProcessed(signal.id, 'repeat_visit_check_handled', meta);
    log('repeat_visit_check_handled', meta);
    return { success: true, action: 'skipped_missing_payload', job_id: jobId };
  }

  let result;
  try {
    result = await xano.getPriorVisitsForCustomer(customerId, applianceType, jobId, MONTHS_WINDOW);
  } catch (err) {
    const meta = { job_id: jobId, outcome: 'context_load_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'repeat_visit_check_handled', meta);
    log('repeat_visit_check_handled', meta);
    return { success: false, action: 'context_load_failed', job_id: jobId };
  }

  const count = Number(result?.count || 0);
  const priorVisits = result?.prior_visits || [];

  if (count < PRIOR_VISIT_THRESHOLD) {
    const meta = { job_id: jobId, outcome: 'clean_first_visit', prior_count: count };
    await xano.markSignalProcessed(signal.id, 'repeat_visit_check_handled', meta);
    log('repeat_visit_check_handled', meta);
    return { success: true, action: 'clean_first_visit', job_id: jobId, prior_count: count };
  }

  // Build callback-risk SMS body for Teddy.
  const appliance = applianceLabel(applianceType);
  const custName = customerLabel(payload);
  const priorIds = priorVisits.map((p) => `#${p.id}`).join(' ');

  const body =
    `[ant] ⚠️ callback risk: ${custName} has ${count} prior ${appliance} jobs. ` +
    `Prior visits: ${priorIds}. Review before dispatch.`;

  let smsRes;
  try {
    smsRes = await toOwner(body, {
      action: 'repeat_visit_flagged',
      job_id: jobId,
      customer_id: customerId,
      prior_count: count,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  // Emit REPEAT_VISIT_FLAGGED for any downstream listener (e.g. future
  // callback_root_cause agent that diffs prior diagnoses).
  let flaggedSignalId = null;
  try {
    const emit = await xano.emitSignal({
      signal_type: 'REPEAT_VISIT_FLAGGED',
      signal_strength: 70,
      payload: {
        job_id: jobId,
        customer_id: customerId,
        appliance_type: applianceType,
        prior_count: count,
        prior_job_ids: priorVisits.map((p) => p.id),
        prior_visits: priorVisits,
        source: 'repeat_visit_check',
        source_signal_id: signal.id,
      },
    });
    flaggedSignalId = emit && (emit.signal_id || emit.id);
  } catch (err) {
    log('repeat_visit_flagged_emit_failed', { job_id: jobId, error: String(err.message || err) });
  }

  const meta = {
    job_id: jobId,
    customer_id: customerId,
    outcome: 'callback_risk_flagged',
    prior_count: count,
    prior_job_ids: priorVisits.map((p) => p.id),
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    flagged_signal_id: flaggedSignalId,
  };
  await xano.markSignalProcessed(signal.id, 'repeat_visit_check_handled', meta);
  log('repeat_visit_check_handled', meta);

  return {
    success: true,
    action: 'callback_risk_flagged',
    job_id: jobId,
    prior_count: count,
  };
}
