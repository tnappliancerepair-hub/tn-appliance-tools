// Handles SMS_RESPONSE_TIME_PREFERENCE signals (emitted by
// inbound_customer_sms.js when a customer replies M / A / MORNING /
// AFTERNOON / ANYTIME / EITHER / EVENING).
//
// Looks up the customer's most recent not_ready parallel-mode job and
// applies the preference text, advancing scheduling_status to
// intake_complete. Auto-scheduler picks it up on next pass.
//
// Signal in:  SMS_RESPONSE_TIME_PREFERENCE
// Signal out: none — auto-scheduler consumes the new intake_complete state
import { normalizeE164, toCustomer } from '../sms.js';

const PREF_MAP = {
  M: 'morning preferred',
  A: 'afternoon preferred',
  MORNING: 'morning preferred',
  AFTERNOON: 'afternoon preferred',
  ANYTIME: 'anytime works',
  EITHER: 'anytime works',
  EVENING: 'evening preferred',
};

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const body = String(payload.body || payload.message || '').trim();
  const customerId = Number(payload.customer_id || 0);
  const phone = String(payload.from || payload.customer_phone || '').trim();

  if (!customerId) {
    await xano.markSignalProcessed(signal.id, 'sms_response_time_preference_handled', {
      outcome: 'skipped_no_customer_id',
      body_preview: body.slice(0, 60),
    });
    return { success: false, action: 'skipped_no_customer_id' };
  }

  const key = body.toUpperCase().replace(/[.!\s]/g, '');
  const prefText = PREF_MAP[key] || body;

  let applyResult = null;
  try {
    applyResult = await xano.applyTimePreference({
      customer_id: customerId,
      preference_text: prefText,
      raw_reply: body,
    });
  } catch (err) {
    log('time_preference_apply_failed', { customer_id: customerId, error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'sms_response_time_preference_handled', {
      outcome: 'apply_failed',
      customer_id: customerId,
      error: String(err.message || err),
    });
    return { success: false, action: 'apply_failed' };
  }

  if (!applyResult || !applyResult.success) {
    await xano.markSignalProcessed(signal.id, 'sms_response_time_preference_handled', {
      outcome: 'no_open_job',
      customer_id: customerId,
    });
    return { success: false, action: 'no_open_job' };
  }

  // Acknowledge the customer so they know it landed
  const normPhone = normalizeE164(phone);
  if (normPhone) {
    try {
      await toCustomer(normPhone, `Got it - ${prefText}. We'll text you when we have a time. Thanks!`, {
        context_tag: 'time_preference_ack',
        job_id: applyResult.job_id,
      });
    } catch (_) { /* SMS gate or invalid phone, fine */ }
  }

  await xano.markSignalProcessed(signal.id, 'sms_response_time_preference_handled', {
    outcome: 'preference_applied',
    customer_id: customerId,
    job_id: applyResult.job_id,
    preference_text: prefText,
  });

  return { success: true, action: 'preference_applied', job_id: applyResult.job_id };
}
