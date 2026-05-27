// Handles CUSTOMER_FEEDBACK_RECEIVED signals (emitted by
// record_customer_feedback_POST.xs OR future feedback_reply_webhook
// rating capture).
//
// - Rating 1-2: SMS Teddy + Danielle URGENT save-the-customer alert
// - Rating 3: silent log (audit only)
// - Rating 4-5: silent — google_review_request already chained off
//   JOB_COMPLETED handles the review ask path
import { config } from '../config.js';
import { toOwner, toDanielle } from '../sms.js';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const rating = Number(payload.rating || 0);
  const comment = String(payload.comment || '').trim();
  const customerId = Number(payload.customer_id || 0);
  const techId = Number(payload.technician_id || 0);

  if (!jobId || !rating || rating < 1 || rating > 5) {
    await xano.markSignalProcessed(signal.id, 'customer_feedback_handled', {
      outcome: 'skipped_invalid_payload',
    });
    return { success: false, action: 'skipped_invalid_payload' };
  }

  if (rating >= 3) {
    await xano.markSignalProcessed(signal.id, 'customer_feedback_handled', {
      outcome: 'skipped_above_threshold',
      rating,
    });
    log('customer_feedback_handled', { outcome: 'skipped_above_threshold', rating });
    return { success: true, action: 'skipped_above_threshold', rating };
  }

  // Low rating (1-2) — urgent alert
  const domain = bareDomain();
  const commentPreview = comment ? ` "${comment.slice(0, 120)}${comment.length > 120 ? '...' : ''}"` : '';
  const body =
    `[ant] 🚨 LOW RATING ${rating}/5 on job #${jobId}${commentPreview}. ` +
    `Tech #${techId}, customer #${customerId}. ` +
    `Review + call back ASAP: ${domain}/job-detail.html?job_id=${jobId}&office=1`;

  let teddyRes = null;
  let danielleRes = null;
  try {
    teddyRes = await toOwner(body, {
      action: 'low_rating_alert_sent',
      job_id: jobId,
      rating,
      source_signal_id: signal.id,
    });
  } catch (err) {
    teddyRes = { success: false, error: String(err.message || err) };
  }
  try {
    danielleRes = await toDanielle(body, {
      action: 'low_rating_alert_sent',
      job_id: jobId,
      rating,
      source_signal_id: signal.id,
    });
  } catch (err) {
    danielleRes = { success: false, error: String(err.message || err) };
  }

  const meta = {
    outcome: 'low_rating_alerted',
    job_id: jobId,
    rating,
    teddy_sms: teddyRes && teddyRes.success ? 'ok' : 'maybe_failed',
    danielle_sms: danielleRes && danielleRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'customer_feedback_handled', meta);
  log('customer_feedback_handled', meta);

  return { success: true, action: 'low_rating_alerted', ...meta };
}
