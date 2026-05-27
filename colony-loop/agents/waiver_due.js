// Handles WAIVER_DUE signals (emitted by appointment_scheduled.js with
// deadline_ms = scheduled_start_ms - 4h). Hold-and-re-emit pattern.
// When the deadline hits, checks if the customer has signed the waiver
// (jotform_waiver_webhook flips jobs.waiver_signed=true on submission).
// If not, sends a customer SMS with the prefilled Jotform URL.
//
// Closes vision step 3: "Waiver signed before tech arrives" — currently
// no automation fires the waiver before the tech rolls; this agent makes
// it happen automatically the moment the deadline lands.
//
// Skip cases:
//   - waiver_signed already true
//   - job canceled or completed
//   - customer has no phone
//   - already sent for this scheduled_start (dedup via compound action key)
import { config } from '../config.js';
import { normalizeE164, toCustomer } from '../sms.js';

const JOTFORM_BASE = 'https://form.jotform.com/260495320372050';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const scheduledStartMs = Number(payload.scheduled_start_ms || 0);
  const deadlineMs = Number(payload.deadline_ms || payload.scheduled_for_ms || 0);

  if (!jobId || !scheduledStartMs || !deadlineMs) {
    await xano.markSignalProcessed(signal.id, 'waiver_due_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  // Hold-and-re-emit.
  if (Date.now() < deadlineMs) {
    try {
      await xano.emitSignal({
        signal_type: 'WAIVER_DUE',
        signal_strength: 50,
        payload,
      });
    } catch (err) {
      log('waiver_due_hold_failed', { job_id: jobId, error: String(err.message || err) });
    }
    const meta = { job_id: jobId, outcome: 'held_until_deadline', deadline_ms: deadlineMs };
    await xano.markSignalProcessed(signal.id, 'waiver_due_handled', meta);
    return { success: true, action: 'held_until_deadline', job_id: jobId };
  }

  // Compound dedup key — same shape as parts_arrival_followup pattern.
  const dedupAction = `waiver_due_sent_${jobId}_${scheduledStartMs}`;
  let priorSend = null;
  try {
    priorSend = await xano.getEventLogByAction(dedupAction);
  } catch (err) {
    // Fail-open on dedup query failures — better to risk a rare duplicate.
    log('waiver_due_dedup_failed', { job_id: jobId, error: String(err.message || err) });
  }
  if (priorSend && priorSend.exists) {
    const meta = { job_id: jobId, outcome: 'skipped_already_sent', last_at: priorSend.last_at };
    await xano.markSignalProcessed(signal.id, 'waiver_due_handled', meta);
    log('waiver_due_handled', meta);
    return { success: true, action: 'skipped_already_sent', job_id: jobId };
  }

  // Pull current waiver state.
  let status;
  try {
    status = await xano.getWaiverStatus(jobId);
  } catch (err) {
    log('waiver_due_status_failed', { job_id: jobId, error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'waiver_due_handled', {
      outcome: 'status_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'status_failed' };
  }
  if (!status || !status.success) {
    const meta = { job_id: jobId, outcome: 'status_not_found' };
    await xano.markSignalProcessed(signal.id, 'waiver_due_handled', meta);
    return { success: false, action: 'status_not_found' };
  }

  const sched = String(status.scheduling_status || '').toLowerCase();
  if (sched === 'canceled' || sched === 'completed' || sched === 'no_fix_possible') {
    const meta = { job_id: jobId, outcome: `skipped_status_${sched}` };
    await xano.markSignalProcessed(signal.id, 'waiver_due_handled', meta);
    log('waiver_due_handled', meta);
    return { success: true, action: meta.outcome, job_id: jobId };
  }

  if (status.waiver_signed === true) {
    const meta = { job_id: jobId, outcome: 'skipped_already_signed', signed_at: status.waiver_signed_at };
    await xano.markSignalProcessed(signal.id, 'waiver_due_handled', meta);
    log('waiver_due_handled', meta);
    return { success: true, action: 'skipped_already_signed', job_id: jobId };
  }

  const customer = status.customer || {};
  const phone = normalizeE164(customer.phone);
  if (!phone) {
    const meta = { job_id: jobId, outcome: 'skipped_no_phone' };
    await xano.markSignalProcessed(signal.id, 'waiver_due_handled', meta);
    return { success: true, action: 'skipped_no_phone' };
  }

  const first = String(customer.first_name || '').trim() || 'there';
  const prefillUrl =
    `${JOTFORM_BASE}?job_id=${jobId}` +
    `&name=${encodeURIComponent(first)}` +
    `&phone=${encodeURIComponent(phone)}`;

  const body =
    `Hi ${first}, please sign the service waiver before your appointment: ${prefillUrl}. ` +
    `Takes 60 seconds. Reply STOP to opt out.`;

  let smsRes;
  try {
    smsRes = await toCustomer(phone, body, {
      action: 'waiver_due_sent',
      job_id: jobId,
      scheduled_start_ms: scheduledStartMs,
      source_signal_id: signal.id,
    });
  } catch (err) {
    log('waiver_due_sms_failed', { job_id: jobId, error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'waiver_due_handled', {
      outcome: 'sms_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'sms_failed' };
  }

  // Write compound dedup row.
  try {
    await xano.recordEventLog(dedupAction, {
      job_id: jobId,
      scheduled_start_ms: scheduledStartMs,
      customer_phone: phone,
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
      source_signal_id: signal.id,
    });
  } catch (err) {
    log('waiver_due_dedup_write_failed', { job_id: jobId, error: String(err.message || err) });
  }

  const meta = {
    job_id: jobId,
    outcome: smsRes && smsRes.success ? 'sent' : 'send_failed',
    scheduled_start_ms: scheduledStartMs,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'waiver_due_handled', meta);
  log('waiver_due_handled', meta);
  return { success: true, action: meta.outcome, job_id: jobId };
}
