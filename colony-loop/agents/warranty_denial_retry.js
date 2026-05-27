// Handles WARRANTY_DENIAL_RETRY signals (emitted by Danielle marking a
// claim as denied in warranty-review.html OR by a future
// warranty_status_poller). Re-builds the claim package via Claude with
// the documented denial reason addressed, then SMSes Danielle for
// review-and-resubmit.
import { config } from '../config.js';
import { toDanielle } from '../sms.js';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const denialReason = String(payload.denial_reason || '').trim();
  const claimNumber = String(payload.claim_number || '').trim();
  const vendor = String(payload.vendor || 'AHS').toUpperCase();

  if (!jobId || !denialReason) {
    await xano.markSignalProcessed(signal.id, 'warranty_denial_retry_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  const dedupAction = `warranty_denial_retry_sent_${jobId}_${claimNumber}`;
  let prior = null;
  try { prior = await xano.getEventLogByAction(dedupAction); } catch (e) { /* */ }
  if (prior && prior.exists) {
    await xano.markSignalProcessed(signal.id, 'warranty_denial_retry_handled', {
      outcome: 'skipped_already_retried',
    });
    return { success: true, action: 'skipped_already_retried' };
  }

  const domain = bareDomain();
  const reasonPreview = denialReason.slice(0, 140);
  const body =
    `[ant] 🔄 ${vendor} DENIAL RETRY job #${jobId} (claim ${claimNumber || 'no#'}). ` +
    `Reason: "${reasonPreview}${denialReason.length > 140 ? '...' : ''}". ` +
    `Resubmit package: ${domain}/warranty-review.html?job_id=${jobId}`;

  let smsRes = null;
  try {
    smsRes = await toDanielle(body, {
      action: 'warranty_denial_retry_sent',
      job_id: jobId,
      vendor,
      claim_number: claimNumber,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  try {
    await xano.recordEventLog(dedupAction, {
      job_id: jobId,
      vendor,
      claim_number: claimNumber,
      denial_reason: denialReason.slice(0, 500),
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    });
  } catch (e) { /* */ }

  // Chain: SELF_WARRANTY_OFFER (1h delayed) — Ant's own warranty pitch
  try {
    const offerDeadline = Date.now() + 60 * 60 * 1000;
    await xano.emitSignal({
      signal_type: 'SELF_WARRANTY_OFFER',
      signal_strength: 40,
      payload: {
        job_id: jobId,
        vendor,
        denial_reason: denialReason.slice(0, 300),
        customer_phone: payload.customer_phone || '',
        first_name: payload.first_name || '',
        deadline_ms: offerDeadline,
        scheduled_for_ms: offerDeadline,
        source: 'warranty_denial_retry_chain',
        source_signal_id: signal.id,
      },
    });
  } catch (err) {
    log('self_warranty_offer_emit_failed', { job_id: jobId, error: String(err.message || err) });
  }

  const meta = {
    job_id: jobId,
    outcome: smsRes && smsRes.success ? 'retry_alerted' : 'send_failed',
    vendor,
  };
  await xano.markSignalProcessed(signal.id, 'warranty_denial_retry_handled', meta);
  log('warranty_denial_retry_handled', meta);
  return { success: true, action: meta.outcome };
}
