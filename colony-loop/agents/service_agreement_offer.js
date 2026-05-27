// Handles SERVICE_AGREEMENT_OFFER signals (emitted by job_completed.js for
// self-pay completions). After the customer gets the Stripe payment SMS
// + 1h delay, send a follow-up offering a 1-year service agreement.
import { config } from '../config.js';
import { normalizeE164, toCustomer } from '../sms.js';

const OFFER_LEAD_MS = 60 * 60 * 1000; // 1h after JOB_COMPLETED
const SERVICE_AGREEMENT_URL = '/service-agreement.html';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const customerId = Number(payload.customer_id || 0);
  const phone = String(payload.customer_phone || '').trim();
  const firstName = String(payload.first_name || '').trim() || 'there';
  const deadlineMs = Number(payload.deadline_ms || payload.scheduled_for_ms || 0);

  if (!jobId || !phone || !deadlineMs) {
    await xano.markSignalProcessed(signal.id, 'service_agreement_offer_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  // Hold-and-re-emit
  if (Date.now() < deadlineMs) {
    try {
      await xano.emitSignal({ signal_type: 'SERVICE_AGREEMENT_OFFER', signal_strength: 30, payload });
    } catch (err) { /* ignore */ }
    await xano.markSignalProcessed(signal.id, 'service_agreement_offer_handled', {
      outcome: 'held_until_deadline',
    });
    return { success: true, action: 'held_until_deadline' };
  }

  // Per-customer-quarterly dedup
  const dedupAction = `service_agreement_offer_sent_customer_${customerId}_${Math.floor(Date.now() / (90 * 24 * 60 * 60 * 1000))}`;
  let priorSend = null;
  try { priorSend = await xano.getEventLogByAction(dedupAction); } catch { /* */ }
  if (priorSend && priorSend.exists) {
    await xano.markSignalProcessed(signal.id, 'service_agreement_offer_handled', {
      outcome: 'skipped_quarterly_dedup',
    });
    return { success: true, action: 'skipped_quarterly_dedup' };
  }

  const normPhone = normalizeE164(phone);
  if (!normPhone) {
    await xano.markSignalProcessed(signal.id, 'service_agreement_offer_handled', {
      outcome: 'skipped_no_phone',
    });
    return { success: false, action: 'skipped_no_phone' };
  }

  const body =
    `Hi ${firstName} - now that we know your appliances, want to lock in priority service for the year? ` +
    `$199 covers a yearly check-up + first-in-line for any repairs. Details: ${bareDomain()}${SERVICE_AGREEMENT_URL}?job_id=${jobId} ` +
    `Reply YES if interested. -TN Appliance`;

  let smsRes = null;
  try {
    smsRes = await toCustomer(normPhone, body, {
      action: 'service_agreement_offer_sent',
      job_id: jobId,
      customer_id: customerId,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  try {
    await xano.recordEventLog(dedupAction, {
      job_id: jobId,
      customer_id: customerId,
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    });
  } catch (err) { /* */ }

  const meta = {
    job_id: jobId,
    outcome: smsRes && smsRes.success ? 'sent' : 'send_failed',
  };
  await xano.markSignalProcessed(signal.id, 'service_agreement_offer_handled', meta);
  log('service_agreement_offer_handled', meta);
  return { success: true, action: meta.outcome };
}
