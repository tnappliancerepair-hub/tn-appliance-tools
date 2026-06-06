// Handles DIAGNOSTIC_PREPAY_DUE signals (emitted when a self-pay job is
// scheduled and we want the $99 diagnostic fee collected before the
// truck rolls). Hold-and-re-emit until appointment - 12h, then SMS the
// customer a Stripe Checkout link.
//
// Reuses the same create-stripe-payment-link Netlify function but with
// amount_cents=9900 and a different SMS body.
import { config } from '../config.js';
import { normalizeE164, toCustomer } from '../sms.js';

const DIAGNOSTIC_FEE_CENTS = 9900;

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const phone = String(payload.customer_phone || '').trim();
  const firstName = String(payload.first_name || '').trim() || 'there';
  const deadlineMs = Number(payload.deadline_ms || 0);

  if (!jobId || !phone || !deadlineMs) {
    await xano.markSignalProcessed(signal.id, 'diagnostic_prepay_handled', { outcome: 'skipped_missing_payload' });
    return { success: false, action: 'skipped_missing_payload' };
  }

  if (Date.now() < deadlineMs) {
  // Dedup: if multiple pending signals exist for this job, skip the
  // re-emit and mark current processed. Collapses runaway dupes over a
  // few ticks back to steady-state 1 pending per job. Prevents the
  // duplicate-SMS-at-deadline bug.
  try {
    const counts = await xano.countPendingSignalsForJob('DIAGNOSTIC_PREPAY_DUE', jobId);
    if (counts && counts.pending_count > 1) {
      log('dedup_skip_reemit', { job_id: jobId, pending_count: counts.pending_count, type: 'DIAGNOSTIC_PREPAY_DUE' });
      await xano.markSignalProcessed(signal.id, 'diagnostic_prepay_due_handled', {
        job_id: jobId, outcome: 'dedup_skip_reemit', pending_count: counts.pending_count,
      });
      return { success: true, action: 'dedup_skip_reemit', job_id: jobId };
    }
  } catch (e) {
    log('dedup_check_failed', { job_id: jobId, type: 'DIAGNOSTIC_PREPAY_DUE', error: String(e.message || e) });
  }

    try { await xano.emitSignal({ signal_type: 'DIAGNOSTIC_PREPAY_DUE', signal_strength: 50, payload }); }
    catch (e) { /* */ }
    await xano.markSignalProcessed(signal.id, 'diagnostic_prepay_handled', { outcome: 'held_until_deadline' });
    return { success: true, action: 'held_until_deadline' };
  }

  const dedup = `diagnostic_prepay_sent_${jobId}`;
  let prior = null;
  try { prior = await xano.getEventLogByAction(dedup); } catch (e) { /* */ }
  if (prior && prior.exists) {
    await xano.markSignalProcessed(signal.id, 'diagnostic_prepay_handled', { outcome: 'skipped_already_sent' });
    return { success: true, action: 'skipped_already_sent' };
  }

  let linkData = null;
  try {
    const fnUrl = `${config.netlifyFunctionsBase}/create-stripe-payment-link`;
    const res = await fetch(fnUrl, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        job_id: jobId,
        amount_cents: DIAGNOSTIC_FEE_CENTS,
        description: `TN Appliance Diagnostic Fee - Job #${jobId}`,
      }),
    });
    linkData = await res.json();
  } catch (err) {
    log('diagnostic_prepay_fn_failed', { job_id: jobId, error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'diagnostic_prepay_handled', { outcome: 'fn_call_failed' });
    return { success: false, action: 'fn_call_failed' };
  }

  if (!linkData || !linkData.ok) {
    await xano.markSignalProcessed(signal.id, 'diagnostic_prepay_handled', { outcome: 'fn_returned_error' });
    return { success: false, action: 'fn_returned_error' };
  }

  const normPhone = normalizeE164(phone);
  if (!normPhone) {
    await xano.markSignalProcessed(signal.id, 'diagnostic_prepay_handled', { outcome: 'skipped_no_phone' });
    return { success: false, action: 'skipped_no_phone' };
  }

  const body =
    `Hi ${firstName} - to lock in your appointment tomorrow, please pay the $99 diagnostic fee: ${linkData.url} ` +
    `Fee is fully credited if you book the repair. Questions? Call 866-268-0111.`;

  let smsRes = null;
  try {
    smsRes = await toCustomer(normPhone, body, {
      action: 'diagnostic_prepay_sent',
      job_id: jobId,
      stripe_session_id: linkData.session_id || null,
      source_signal_id: signal.id,
    });
  } catch (err) { smsRes = { success: false, error: String(err.message || err) }; }

  try {
    await xano.recordEventLog(dedup, {
      job_id: jobId,
      stripe_session_id: linkData.session_id || null,
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    });
  } catch (e) { /* */ }

  const meta = { job_id: jobId, outcome: smsRes && smsRes.success ? 'sent' : 'send_failed' };
  await xano.markSignalProcessed(signal.id, 'diagnostic_prepay_handled', meta);
  log('diagnostic_prepay_handled', meta);
  return { success: true, action: meta.outcome };
}
