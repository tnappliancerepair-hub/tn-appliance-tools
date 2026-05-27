// Handles NO_SHOW_CHECK signals (emitted by job_started.js with
// deadline_ms = job_started_at + 6h). Hold-and-re-emit until deadline.
// When deadline arrives, check whether the job has been completed. If
// not, SMS Teddy so he can check on the tech.
//
// "No-show" here means the tech tapped Start Job but never tapped
// Complete within 6 hours — most jobs are 30-90 min, but real repairs
// (compressor swaps, hard disassembly) can legitimately go 4-5h, so
// 6h is the threshold that meaningfully flags 'something is off'
// (tech got stuck, had a customer issue, forgot to tap Complete, etc.).
//
// Skip when:
//   - job has been completed (jobs.job_completed_at != null)
//   - job has been canceled
import { toOwner, normalizeE164 } from '../sms.js';

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const deadlineMs = Number(payload.deadline_ms || payload.scheduled_for_ms || 0);
  const startedAtMs = Number(payload.started_at_ms || 0);

  if (!jobId || !deadlineMs) {
    await xano.markSignalProcessed(signal.id, 'no_show_check_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  // Hold-and-re-emit until deadline.
  if (Date.now() < deadlineMs) {
  // Dedup: if multiple pending signals exist for this job, skip the
  // re-emit and mark current processed. Collapses runaway dupes over a
  // few ticks back to steady-state 1 pending per job. Prevents the
  // duplicate-SMS-at-deadline bug.
  try {
    const counts = await xano.countPendingSignalsForJob('NO_SHOW_CHECK', jobId);
    if (counts && counts.pending_count > 1) {
      log('dedup_skip_reemit', { job_id: jobId, pending_count: counts.pending_count, type: 'NO_SHOW_CHECK' });
      await xano.markSignalProcessed(signal.id, 'no_show_check_handled', {
        job_id: jobId, outcome: 'dedup_skip_reemit', pending_count: counts.pending_count,
      });
      return { success: true, action: 'dedup_skip_reemit', job_id: jobId };
    }
  } catch (e) {
    log('dedup_check_failed', { job_id: jobId, type: 'NO_SHOW_CHECK', error: String(e.message || e) });
  }

    try {
      await xano.emitSignal({
        signal_type: 'NO_SHOW_CHECK',
        signal_strength: 55,
        payload,
      });
    } catch (err) {
      log('no_show_check_hold_failed', { job_id: jobId, error: String(err.message || err) });
    }
    const meta = { job_id: jobId, outcome: 'held_until_deadline', deadline_ms: deadlineMs };
    await xano.markSignalProcessed(signal.id, 'no_show_check_handled', meta);
    return { success: true, action: 'held_until_deadline', job_id: jobId };
  }

  // Past deadline. Pull current job state.
  let job = null;
  let customer = null;
  let tech = null;
  try {
    const ctxData = await xano.getTechAssignmentContext(jobId, payload.technician_id || 0);
    job = ctxData?.job || null;
    customer = ctxData?.customer || null;
    tech = ctxData?.tech || null;
  } catch (err) {
    log('no_show_check_context_failed', { job_id: jobId, error: String(err.message || err) });
  }

  if (!job) {
    const meta = { job_id: jobId, outcome: 'context_load_failed' };
    await xano.markSignalProcessed(signal.id, 'no_show_check_handled', meta);
    return { success: false, action: 'context_load_failed' };
  }

  const completedAt = job.job_completed_at || null;
  if (completedAt) {
    const meta = { job_id: jobId, outcome: 'completed_on_time', completed_at: completedAt };
    await xano.markSignalProcessed(signal.id, 'no_show_check_handled', meta);
    log('no_show_check_handled', meta);
    return { success: true, action: 'completed_on_time', job_id: jobId };
  }

  const status = String(job.scheduling_status || '').toLowerCase();
  if (status === 'canceled' || status === 'no_fix_possible') {
    const meta = { job_id: jobId, outcome: `skipped_${status}` };
    await xano.markSignalProcessed(signal.id, 'no_show_check_handled', meta);
    log('no_show_check_handled', meta);
    return { success: true, action: meta.outcome, job_id: jobId };
  }

  // SMS Teddy.
  const elapsedHr = startedAtMs ? Math.round((Date.now() - startedAtMs) / 3600000 * 10) / 10 : 4;
  const techName = tech && tech.first_name ? String(tech.first_name).trim() : 'tech';
  const custName = customer
    ? `${(customer.first_name || '').trim()} ${(customer.last_name || '').trim().slice(0,1)}${customer.last_name ? '.' : ''}`.trim() || 'customer'
    : 'customer';
  const appliance = String(job.appliance_type || '').toLowerCase() || 'appliance';
  const body =
    `[ant] ⚠️ ${techName} still on job #${jobId} — ${elapsedHr}h elapsed since Start. ` +
    `${custName}, ${appliance}. Check in.`;

  let smsRes = null;
  try {
    smsRes = await toOwner(body, {
      action: 'no_show_alert',
      job_id: jobId,
      technician_id: tech?.id || null,
      elapsed_hours: elapsedHr,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  const meta = {
    job_id: jobId,
    outcome: 'no_show_alert_sent',
    elapsed_hours: elapsedHr,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'no_show_check_handled', meta);
  log('no_show_check_handled', meta);

  return { success: true, action: 'no_show_alert_sent', job_id: jobId };
}
