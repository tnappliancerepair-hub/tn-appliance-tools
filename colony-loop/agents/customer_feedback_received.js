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

  // ── Outcome learning: attribute the rating back to recent claude
  // calls for this customer + job. Side-task — does not gate.
  try {
    const { linkOutcomesForJob } = await import('./claude_outcome_linker.js');
    const value = rating >= 4 ? 'good' : (rating <= 2 ? 'bad' : 'neutral');
    if (customerId) {
      linkOutcomesForJob(signal, ctx, {
        outcomeType: 'customer_rating',
        outcomeValue: String(rating),
        lookbackDays: 14,
        entityKey: 'customer_id',
        entityId: customerId,
      }).catch(() => {});
    }
    if (jobId) {
      linkOutcomesForJob(signal, ctx, {
        outcomeType: 'customer_rating_for_job',
        outcomeValue: value,
        lookbackDays: 14,
        entityKey: 'job_id',
        entityId: jobId,
      }).catch(() => {});
    }
  } catch (_) {}

  if (rating >= 4) {
    // High rating → fire Google review ask IMMEDIATELY (deadline=now)
    // rather than waiting for the 7d post-completion timer. Higher
    // conversion because the customer is engaged right now. Existing
    // per-customer 60-day dedup in google_review_request prevents a
    // duplicate ask if the JOB_COMPLETED chain also fires later.
    try {
      const nowDeadline = Date.now() - 1000; // already past → agent sends immediately
      await xano.emitSignal({
        signal_type: 'GOOGLE_REVIEW_REQUEST',
        signal_strength: 50,
        payload: {
          job_id: jobId,
          customer_id: customerId,
          customer_phone: payload.customer_phone || '',
          first_name: payload.first_name || '',
          tech_first: payload.tech_first || '',
          deadline_ms: nowDeadline,
          scheduled_for_ms: nowDeadline,
          source: 'customer_feedback_high_rating_chain',
          source_signal_id: signal.id,
        },
      });
    } catch (err) {
      log('high_rating_review_chain_failed', { job_id: jobId, error: String(err.message || err) });
    }
    await xano.markSignalProcessed(signal.id, 'customer_feedback_handled', {
      outcome: 'high_rating_review_chained',
      rating,
    });
    log('customer_feedback_handled', { outcome: 'high_rating_review_chained', rating });
    return { success: true, action: 'high_rating_review_chained', rating };
  }

  if (rating === 3) {
    await xano.markSignalProcessed(signal.id, 'customer_feedback_handled', {
      outcome: 'skipped_neutral',
      rating,
    });
    log('customer_feedback_handled', { outcome: 'skipped_neutral', rating });
    return { success: true, action: 'skipped_neutral', rating };
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
