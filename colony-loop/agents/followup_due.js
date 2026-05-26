// Handles FOLLOWUP_DUE signals (emitted by job_completed.js with a 24-hour
// deadline_ms). Uses the hold-and-re-emit pattern (same as
// tech_arrival_check.js): if Date.now() < deadline_ms, re-emit the signal
// with the same payload and skip; when deadline passes, post the customer
// SMS via the existing send_feedback_sms endpoint.
//
// send_feedback_sms is the production feedback request path — it already
// handles dedup (skips if jobs.feedback_sent=true), Twilio delivery, and
// audit logging. The matching feedback_reply_webhook classifies the
// customer's reply (1-5 rating, ISSUE keyword, etc.) and updates the
// jobs.feedback_type column.
//
// Why a separate followup_due agent vs. firing send_feedback_sms inline:
// the 24h window means we cannot block job_completed for a day. Emitting
// a signal that holds-and-re-emits lets the loop's existing tick cadence
// drive the eventual send without scheduling infrastructure.
import { config } from '../config.js';

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const deadlineMs = Number(payload.deadline_ms || payload.scheduled_for_ms || 0);

  if (!jobId || !deadlineMs) {
    await xano.markSignalProcessed(signal.id, 'followup_due_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  // Hold-and-re-emit. The loop tick re-fires this until the deadline arrives.
  if (Date.now() < deadlineMs) {
    try {
      await xano.emitSignal({
        signal_type: 'FOLLOWUP_DUE',
        signal_strength: 50,
        payload, // verbatim — preserve deadline_ms
      });
    } catch (err) {
      log('followup_due_hold_failed', { job_id: jobId, error: String(err.message || err) });
    }
    const meta = { job_id: jobId, outcome: 'held_until_deadline', deadline_ms: deadlineMs };
    await xano.markSignalProcessed(signal.id, 'followup_due_handled', meta);
    return { success: true, action: 'held_until_deadline', job_id: jobId };
  }

  // Past the 24h deadline. Pull job + customer context, then call
  // send_feedback_sms. The endpoint's internal dedup (jobs.feedback_sent)
  // is the durable guard — even if multiple FOLLOWUP_DUE signals slip
  // past, only the first send fires.
  let job = null;
  let customer = null;
  try {
    const ctxData = await xano.getTechAssignmentContext(jobId, 0);
    job = ctxData?.job || null;
    customer = ctxData?.customer || null;
  } catch (err) {
    log('followup_due_context_failed', { job_id: jobId, error: String(err.message || err) });
  }

  if (!customer || !customer.phone) {
    const meta = {
      job_id: jobId,
      outcome: 'skipped_no_customer_phone',
      has_job: !!job,
      has_customer: !!customer,
    };
    await xano.markSignalProcessed(signal.id, 'followup_due_handled', meta);
    log('followup_due_handled', meta);
    return { success: true, action: 'skipped_no_customer_phone' };
  }

  let normPhone = String(customer.phone || '').trim();
  const digits = normPhone.replace(/[^0-9]/g, '');
  if (digits.length === 10) normPhone = '+1' + digits;
  else if (digits.length === 11 && digits.startsWith('1')) normPhone = '+' + digits;

  let sendResult = null;
  try {
    sendResult = await xano.sendFeedbackSms({
      job_id: jobId,
      customer_phone: normPhone,
      customer_first_name: String(customer.first_name || '').trim() || 'there',
    });
  } catch (err) {
    sendResult = { success: false, error: String(err.message || err) };
  }

  const meta = {
    job_id: jobId,
    outcome: sendResult && sendResult.success ? 'feedback_sent' : 'send_failed',
    customer_id: customer.id,
    elapsed_ms: Date.now() - (deadlineMs - 24 * 60 * 60 * 1000),
    error: sendResult && !sendResult.success ? (sendResult.error || sendResult.message || '') : null,
  };
  await xano.markSignalProcessed(signal.id, 'followup_due_handled', meta);
  log('followup_due_handled', meta);

  return { success: true, action: meta.outcome, job_id: jobId };
}
