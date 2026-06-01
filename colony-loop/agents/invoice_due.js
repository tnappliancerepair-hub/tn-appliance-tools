// Auto-fires the customer their printable-invoice link the moment a
// self-pay JOB_COMPLETED chains through. Used to be Danielle's manual
// step ("did I send the invoice?"); now zero-touch.
//
// Signal in:  INVOICE_DUE  (from job_completed.js, self-pay only)
// Signal out: none — terminal
// Side effects:
//   - SMS customer the invoice link with phone last4 baked in
//   - event_log row action="invoice_sent_<job_id>" (dedup)
import { normalizeE164, toCustomer } from '../sms.js';

const BARE_DOMAIN = 'tnapplianceexchange.net';

function bareInvoiceUrl(jobId, last4) {
  return `https://${BARE_DOMAIN}/.netlify/functions/customer-invoice?job_id=${jobId}&last4=${last4}`;
}

function last4Of(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '';
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);

  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'invoice_due_handled', {
      outcome: 'skipped_missing_job_id',
    });
    return { success: false, action: 'skipped_missing_job_id' };
  }

  // Per-job dedup — no double-invoice even if signal fires twice
  const dedupAction = `invoice_sent_${jobId}`;
  try {
    const prior = await xano.getEventLogByAction(dedupAction);
    if (prior && prior.exists) {
      await xano.markSignalProcessed(signal.id, 'invoice_due_handled', {
        job_id: jobId,
        outcome: 'skipped_already_sent',
      });
      return { success: true, action: 'skipped_already_sent' };
    }
  } catch (_) { /* fail-open */ }

  // Pull job + customer detail
  let view = null;
  try {
    view = await xano.getJobForDashboard(jobId);
  } catch (err) {
    log('invoice_due_fetch_failed', { job_id: jobId, error: String(err.message || err) });
  }
  const job = (view && view.job) || {};
  const cust = (view && view.customer) || {};
  const phone = String(cust.phone || payload.customer_phone || '').trim();
  const firstName = String(cust.first_name || payload.first_name || '').trim() || 'there';
  const last4 = last4Of(phone);
  const normPhone = normalizeE164(phone);

  if (!normPhone || !last4) {
    await xano.markSignalProcessed(signal.id, 'invoice_due_handled', {
      job_id: jobId,
      outcome: 'skipped_no_phone',
    });
    return { success: false, action: 'skipped_no_phone' };
  }

  const url = bareInvoiceUrl(jobId, last4);
  const body = `Hi ${firstName} - your invoice from TN Appliance Exchange is ready: ${url} Tap to view or print. Thanks for trusting us! -Ant`;

  let smsResult = null;
  try {
    smsResult = await toCustomer(normPhone, body, { context_tag: 'invoice_due', job_id: jobId });
  } catch (err) {
    log('invoice_due_sms_failed', { job_id: jobId, error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'invoice_due_handled', {
      job_id: jobId,
      outcome: 'sms_error',
      error: String(err.message || err),
    });
    return { success: false, action: 'sms_error' };
  }

  await xano.markSignalProcessed(signal.id, dedupAction, {
    job_id: jobId,
    customer_id: cust.id || payload.customer_id || null,
    last4,
    invoice_url: url,
    sms_attempted: !!smsResult,
    outcome: 'invoice_sent',
  });

  return {
    success: true,
    action: 'invoice_sent',
    job_id: jobId,
    invoice_url: url,
  };
}
