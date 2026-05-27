// Handles SELF_WARRANTY_OFFER signals (emitted by warranty_denial_retry
// when AHS/Frontdoor denies a claim). 1h delayed customer SMS pitching
// Ant's own 1-year warranty as the alternative.
import { config } from '../config.js';
import { normalizeE164, toCustomer } from '../sms.js';

function bareDomain() { return (config.publicSiteBase || '').replace(/^https?:\/\//, ''); }

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const phone = String(payload.customer_phone || '').trim();
  const firstName = String(payload.first_name || '').trim() || 'there';
  const vendor = String(payload.vendor || 'your home warranty').toLowerCase();
  const deadlineMs = Number(payload.deadline_ms || 0);

  if (!jobId || !phone || !deadlineMs) {
    await xano.markSignalProcessed(signal.id, 'self_warranty_offer_handled', { outcome: 'skipped_missing_payload' });
    return { success: false, action: 'skipped_missing_payload' };
  }

  if (Date.now() < deadlineMs) {
    try { await xano.emitSignal({ signal_type: 'SELF_WARRANTY_OFFER', signal_strength: 40, payload }); }
    catch (e) { /* */ }
    await xano.markSignalProcessed(signal.id, 'self_warranty_offer_handled', { outcome: 'held_until_deadline' });
    return { success: true, action: 'held_until_deadline' };
  }

  const dedup = `self_warranty_offer_sent_${jobId}`;
  let prior = null;
  try { prior = await xano.getEventLogByAction(dedup); } catch (e) { /* */ }
  if (prior && prior.exists) {
    await xano.markSignalProcessed(signal.id, 'self_warranty_offer_handled', { outcome: 'skipped_already_sent' });
    return { success: true, action: 'skipped_already_sent' };
  }

  const normPhone = normalizeE164(phone);
  if (!normPhone) {
    await xano.markSignalProcessed(signal.id, 'self_warranty_offer_handled', { outcome: 'skipped_no_phone' });
    return { success: false, action: 'skipped_no_phone' };
  }

  const body =
    `Hi ${firstName} - sorry your ${vendor} claim didn't go through. ` +
    `Ant offers our own 1-year service warranty for $199 - covers parts + labor on the same appliance. ` +
    `Reply YES if interested, or call 615-280-2949. Details: ${bareDomain()}/service-agreement.html?job_id=${jobId}`;

  let smsRes = null;
  try {
    smsRes = await toCustomer(normPhone, body, {
      action: 'self_warranty_offer_sent',
      job_id: jobId,
      source_signal_id: signal.id,
    });
  } catch (err) { smsRes = { success: false, error: String(err.message || err) }; }

  try {
    await xano.recordEventLog(dedup, { job_id: jobId, sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed' });
  } catch (e) { /* */ }

  const meta = { job_id: jobId, outcome: smsRes && smsRes.success ? 'sent' : 'send_failed' };
  await xano.markSignalProcessed(signal.id, 'self_warranty_offer_handled', meta);
  log('self_warranty_offer_handled', meta);
  return { success: true, action: meta.outcome };
}
