// Handles GOOGLE_REVIEW_REQUEST signals (emitted by job_completed.js
// with deadline = now + 7 days for warranty completions). Hold-and-
// re-emit pattern. At deadline, sends the customer a one-time review
// ask.
//
// Skip cases:
//   - already asked this customer for a review within the last 60 days
//     (dedup via compound action customer_id-scoped)
//   - customer has no phone
//   - we have evidence of dissatisfaction (future: check feedback_replies
//     for any LOW_RATING or ISSUE flag)
import { config } from '../config.js';
import { normalizeE164, toCustomer } from '../sms.js';

const GOOGLE_REVIEW_URL = 'https://g.page/r/CWY8wW48EgvuEAI/review'; // tn appliance google reviews link

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const customerId = Number(payload.customer_id || 0);
  const firstName = String(payload.first_name || '').trim() || 'there';
  const phone = String(payload.customer_phone || '').trim();
  const techFirst = String(payload.tech_first || '').trim();
  const deadlineMs = Number(payload.deadline_ms || payload.scheduled_for_ms || 0);

  if (!jobId || !phone || !deadlineMs) {
    await xano.markSignalProcessed(signal.id, 'google_review_request_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  // Hold-and-re-emit
  if (Date.now() < deadlineMs) {
  // Dedup: if multiple pending signals exist for this job, skip the
  // re-emit and mark current processed. Collapses runaway dupes over a
  // few ticks back to steady-state 1 pending per job. Prevents the
  // duplicate-SMS-at-deadline bug.
  try {
    const counts = await xano.countPendingSignalsForJob('GOOGLE_REVIEW_REQUEST', jobId);
    if (counts && counts.pending_count > 1) {
      log('dedup_skip_reemit', { job_id: jobId, pending_count: counts.pending_count, type: 'GOOGLE_REVIEW_REQUEST' });
      await xano.markSignalProcessed(signal.id, 'google_review_request_handled', {
        job_id: jobId, outcome: 'dedup_skip_reemit', pending_count: counts.pending_count,
      });
      return { success: true, action: 'dedup_skip_reemit', job_id: jobId };
    }
  } catch (e) {
    log('dedup_check_failed', { job_id: jobId, type: 'GOOGLE_REVIEW_REQUEST', error: String(e.message || e) });
  }

    try {
      await xano.emitSignal({
        signal_type: 'GOOGLE_REVIEW_REQUEST',
        signal_strength: 35,
        payload,
      });
    } catch (err) {
      log('google_review_hold_failed', { job_id: jobId, error: String(err.message || err) });
    }
    await xano.markSignalProcessed(signal.id, 'google_review_request_handled', {
      outcome: 'held_until_deadline',
      deadline_ms: deadlineMs,
    });
    return { success: true, action: 'held_until_deadline', job_id: jobId };
  }

  // Per-customer dedup (60 day window) — don't spam frequent customers
  const dedupAction = `google_review_asked_customer_${customerId}`;
  let priorAsk = null;
  try {
    priorAsk = await xano.getEventLogByAction(dedupAction);
  } catch (err) {
    log('google_review_dedup_failed', { job_id: jobId, error: String(err.message || err) });
  }
  if (priorAsk && priorAsk.exists) {
    // Check if within 60 days
    const lastAt = priorAsk.last_at ? new Date(priorAsk.last_at).getTime() : 0;
    const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
    if (lastAt > Date.now() - sixtyDaysMs) {
      await xano.markSignalProcessed(signal.id, 'google_review_request_handled', {
        outcome: 'skipped_recently_asked',
        last_at: priorAsk.last_at,
      });
      return { success: true, action: 'skipped_recently_asked', job_id: jobId };
    }
  }

  const normalizedPhone = normalizeE164(phone);
  if (!normalizedPhone) {
    await xano.markSignalProcessed(signal.id, 'google_review_request_handled', {
      outcome: 'skipped_no_phone',
    });
    return { success: false, action: 'skipped_no_phone' };
  }

  const techClause = techFirst ? `${techFirst} ` : '';
  const body =
    `Hi ${firstName} - hoping ${techClause}got your appliance fixed up well! ` +
    `If you have 30 seconds, a Google review would mean the world to our small team: ${GOOGLE_REVIEW_URL} ` +
    `Reply STOP to opt out.`;

  let smsRes = null;
  try {
    smsRes = await toCustomer(normalizedPhone, body, {
      action: 'google_review_request_sent',
      job_id: jobId,
      customer_id: customerId,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  // Write per-customer dedup
  try {
    await xano.recordEventLog(dedupAction, {
      job_id: jobId,
      customer_id: customerId,
      customer_phone: normalizedPhone,
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
      source_signal_id: signal.id,
    });
  } catch (err) {
    log('google_review_dedup_write_failed', { job_id: jobId, error: String(err.message || err) });
  }

  const meta = {
    job_id: jobId,
    customer_id: customerId,
    outcome: smsRes && smsRes.success ? 'sent' : 'send_failed',
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'google_review_request_handled', meta);
  log('google_review_request_handled', meta);

  return { success: true, action: meta.outcome, job_id: jobId };
}
