// Handles STRIPE_PAYMENT_LINK_DUE signals (emitted by job_completed.js when
// customer_type=self_pay and a job completes). Texts the customer the DURABLE
// pay.html link (never expires) via the send-pay-link Netlify function.
//
// 2026-08-08: was creating an EXPIRING create-stripe-payment-link checkout URL
// and texting that — it died in 24h and left customers on the dead "checkout
// session timed out" page (Jennifer Roher's hoses). Now it sends the stable
// pay.html?job=&t= link, which shows the recorded balance + itemization + tip and
// mints a fresh Stripe session on each tap. send-pay-link resolves the phone +
// enforces opt-out server-side and sends from the approved office line.
//
// Per-job dedup via event_log compound action key — never send twice for a job.
import { config } from '../config.js';

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const customerId = Number(payload.customer_id || 0);

  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'stripe_payment_link_handled', { outcome: 'skipped_missing_payload' });
    return { success: false, action: 'skipped_missing_payload' };
  }

  const dedupAction = `stripe_payment_link_sent_${jobId}`;
  let priorSend = null;
  try { priorSend = await xano.getEventLogByAction(dedupAction); }
  catch (err) { log('stripe_payment_link_dedup_failed', { job_id: jobId, error: String(err.message || err) }); }
  if (priorSend && priorSend.exists) {
    await xano.markSignalProcessed(signal.id, 'stripe_payment_link_handled', { outcome: 'skipped_already_sent', last_at: priorSend.last_at });
    return { success: true, action: 'skipped_already_sent' };
  }

  // Send the durable pay link (replaces the old expiring checkout URL).
  let res = null;
  try {
    const r = await fetch(`${config.netlifyFunctionsBase}/send-pay-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, sender: 'office' }),
    });
    res = await r.json();
  } catch (err) {
    log('stripe_payment_link_fn_failed', { job_id: jobId, error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'stripe_payment_link_handled', { outcome: 'fn_call_failed', error: String(err.message || err) });
    return { success: false, action: 'fn_call_failed' };
  }

  const sent = !!(res && res.sent);
  const reason = (res && res.reason) || null;   // no_phone / opted_out / etc.

  try {
    await xano.recordEventLog(dedupAction, {
      job_id: jobId, customer_id: customerId, durable: true,
      sms_result: sent ? 'ok' : 'maybe_failed', reason, source_signal_id: signal.id,
    });
  } catch (err) { log('stripe_payment_link_dedup_write_failed', { job_id: jobId, error: String(err.message || err) }); }

  const meta = { job_id: jobId, outcome: sent ? 'sent' : 'send_failed', durable: true, reason };
  await xano.markSignalProcessed(signal.id, 'stripe_payment_link_handled', meta);
  log('stripe_payment_link_handled', meta);
  return { success: true, action: meta.outcome, job_id: jobId };
}
