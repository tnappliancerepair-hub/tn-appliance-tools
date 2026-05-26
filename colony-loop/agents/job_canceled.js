// Handles JOB_CANCELED signals (emitted by api/intake/cancel_job_POST.xs
// when the office cancels a job via office-calendar.html's manage modal).
//
// Sends a single SMS to the customer letting them know the appointment
// won't happen, and notifies the assigned tech (when one was set) so they
// don't roll up to a canceled door.
//
// Skip cases:
//   - missing job_id: skip with reason
//   - tech-canceled or system-canceled where source != "office_cancel":
//     the producer flags those; we only SMS for office-initiated cancels
//     so we don't compound notifications when the customer themselves
//     drove the cancel (their own outbound message implies awareness).
import { config } from '../config.js';
import { toCustomer, toTech, normalizeE164 } from '../sms.js';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

function customerLabel(c) {
  if (!c) return 'there';
  return (c.first_name || c.last_name || '').trim() || 'there';
}

function applianceLabel(j) {
  return String((j && j.appliance_type) || '').trim().toLowerCase() || 'appliance';
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'job_canceled_handled', { outcome: 'skipped_missing_job_id' });
    return { success: false, action: 'skipped_missing_job_id' };
  }

  const source = String(payload.source || '').toLowerCase();
  if (source && source !== 'office_cancel') {
    const meta = { job_id: jobId, outcome: 'skipped_non_office_cancel', source };
    await xano.markSignalProcessed(signal.id, 'job_canceled_handled', meta);
    log('job_canceled_handled', meta);
    return { success: true, action: 'skipped_non_office_cancel' };
  }

  // Load job + customer + tech context (reuse tech assignment context endpoint
  // — it returns the same {job, customer, tech} bundle we need).
  let ctxData = null;
  try {
    ctxData = await xano.getTechAssignmentContext(jobId, payload.technician_id || 0);
  } catch (err) {
    /* fall through with null ctxData */
  }
  const job = (ctxData && ctxData.job) || null;
  const customer = (ctxData && ctxData.customer) || null;
  const tech = (ctxData && ctxData.tech) || null;

  let customerSms = null;
  if (customer && customer.phone) {
    const phone = normalizeE164(customer.phone);
    if (phone) {
      const name = customerLabel(customer);
      const appl = applianceLabel(job);
      const reason = String(payload.reason || '').trim();
      const reasonClause = reason ? ` (${reason})` : '';
      const body =
        `Hi ${name} - your ${appl} repair appointment has been canceled${reasonClause}. ` +
        `If this is unexpected or you'd like to reschedule, just reply here. - TN Appliance Exchange`;
      try {
        customerSms = await toCustomer(phone, body, {
          action: 'job_canceled_customer_notice',
          job_id: jobId,
          customer_id: customer.id,
          source_signal_id: signal.id,
        });
      } catch (err) {
        customerSms = { success: false, error: String(err.message || err) };
      }
    }
  }

  let techSms = null;
  if (tech && tech.phone && tech.id && tech.id !== 1) {
    const techPhone = normalizeE164(tech.phone);
    if (techPhone) {
      const cust = customer ? customerLabel(customer) : 'customer';
      const appl = applianceLabel(job);
      const body =
        `[ant] job #${jobId} canceled - ${cust}, ${appl}. ` +
        `Remove from your day: ${bareDomain()}/tech-daily-dashboard.html?tech_id=${tech.id}`;
      try {
        techSms = await toTech(techPhone, body, {
          action: 'job_canceled_tech_notice',
          job_id: jobId,
          technician_id: tech.id,
          source_signal_id: signal.id,
        });
      } catch (err) {
        techSms = { success: false, error: String(err.message || err) };
      }
    }
  }

  const meta = {
    job_id: jobId,
    outcome: 'cancel_sms_sent',
    customer_sms: customerSms && customerSms.success ? 'ok' : (customerSms ? 'maybe_failed' : 'no_phone'),
    tech_sms: techSms && techSms.success ? 'ok' : (techSms ? 'maybe_failed' : 'no_phone_or_owner'),
    reason: String(payload.reason || ''),
  };
  await xano.markSignalProcessed(signal.id, 'job_canceled_handled', meta);
  log('job_canceled_handled', meta);

  return { success: true, action: 'cancel_sms_sent', job_id: jobId };
}
