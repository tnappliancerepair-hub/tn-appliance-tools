// Handles STRIPE_PAYMENT_LINK_DUE signals (emitted by job_completed.js when
// customer_type=self_pay and tech_job_complete fires). Generates a Stripe
// Checkout Session via netlify/functions/create-stripe-payment-link, then
// SMSes the customer the hosted-checkout URL.
//
// Per-job dedup via event_log compound action key — don't send the same
// payment link twice for the same job.
import { config } from '../config.js';
import { normalizeE164, toCustomer } from '../sms.js';

const DEFAULT_DIAGNOSTIC_FEE_CENTS = 9900; // $99 fallback when no amount captured

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const customerId = Number(payload.customer_id || 0);
  const firstName = String(payload.first_name || '').trim() || 'there';
  const phone = String(payload.customer_phone || '').trim();
  const amountCents = Number(payload.amount_cents || DEFAULT_DIAGNOSTIC_FEE_CENTS);
  const customerEmail = String(payload.customer_email || '').trim();

  if (!jobId || !phone) {
    await xano.markSignalProcessed(signal.id, 'stripe_payment_link_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  const dedupAction = `stripe_payment_link_sent_${jobId}`;
  let priorSend = null;
  try {
    priorSend = await xano.getEventLogByAction(dedupAction);
  } catch (err) {
    log('stripe_payment_link_dedup_failed', { job_id: jobId, error: String(err.message || err) });
  }
  if (priorSend && priorSend.exists) {
    await xano.markSignalProcessed(signal.id, 'stripe_payment_link_handled', {
      outcome: 'skipped_already_sent',
      last_at: priorSend.last_at,
    });
    return { success: true, action: 'skipped_already_sent' };
  }

  // Call Netlify function to create the Checkout Session
  let linkData = null;
  try {
    const fnUrl = `${config.netlifyFunctionsBase}/create-stripe-payment-link`;
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        amount_cents: amountCents,
        description: `TN Appliance Exchange Job #${jobId}`,
        customer_email: customerEmail || undefined,
      }),
    });
    linkData = await res.json();
  } catch (err) {
    log('stripe_payment_link_fn_failed', { job_id: jobId, error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'stripe_payment_link_handled', {
      outcome: 'fn_call_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'fn_call_failed' };
  }

  if (!linkData || !linkData.ok) {
    await xano.markSignalProcessed(signal.id, 'stripe_payment_link_handled', {
      outcome: 'fn_returned_error',
      error: (linkData && linkData.error) || 'unknown',
    });
    return { success: false, action: 'fn_returned_error' };
  }

  const normalizedPhone = normalizeE164(phone);
  if (!normalizedPhone) {
    await xano.markSignalProcessed(signal.id, 'stripe_payment_link_handled', {
      outcome: 'skipped_invalid_phone',
    });
    return { success: false, action: 'skipped_invalid_phone' };
  }

  const dollars = (amountCents / 100).toFixed(2);
  // Tech tip-jar: per-tech Venmo/Zelle handle from payload (operator can
  // pre-fill technicians.tip_handle column). Falls back to no tip clause.
  const tipHandle = String(payload.tech_tip_handle || '').trim();
  const tipClause = tipHandle ? ` Want to tip ${payload.tech_first || 'your tech'}? ${tipHandle}` : '';
  const body =
    `Hi ${firstName} - thanks for trusting us with your repair! ` +
    `Pay your $${dollars} balance securely here: ${linkData.url} ` +
    `Questions? Call 615-280-2949.${tipClause}`;

  let smsRes = null;
  try {
    smsRes = await toCustomer(normalizedPhone, body, {
      action: 'stripe_payment_link_sent',
      job_id: jobId,
      customer_id: customerId,
      amount_cents: amountCents,
      stripe_session_id: linkData.session_id || null,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  try {
    await xano.recordEventLog(dedupAction, {
      job_id: jobId,
      customer_id: customerId,
      amount_cents: amountCents,
      stripe_session_id: linkData.session_id || null,
      stripe_url: linkData.url,
      placeholder: !!linkData.placeholder,
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
      source_signal_id: signal.id,
    });
  } catch (err) {
    log('stripe_payment_link_dedup_write_failed', { job_id: jobId, error: String(err.message || err) });
  }

  const meta = {
    job_id: jobId,
    outcome: smsRes && smsRes.success ? 'sent' : 'send_failed',
    amount_cents: amountCents,
    placeholder: !!linkData.placeholder,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'stripe_payment_link_handled', meta);
  log('stripe_payment_link_handled', meta);

  return { success: true, action: meta.outcome, job_id: jobId };
}
