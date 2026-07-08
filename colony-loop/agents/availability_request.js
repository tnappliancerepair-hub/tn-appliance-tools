// availability_request.js — Ant proactively asks the customer for their
// AVAILABLE + UNAVAILABLE times (the #1 scheduling variable). One SMS that asks
// the question AND carries the portal link, so the customer can answer three
// ways: reply right here (parsed by sms_response_availability), tap the link to
// fill the structured form, or tell Ant on a call. SquareTrade / ServicePower
// (vendor pre-scheduled) jobs are skipped.
//
// TEST-FIRST: until AVAILABILITY_ASK_LIVE=true in colony-loop/.env, every ask is
// redirected to the OWNER's phone with a [test→…] prefix, so we prove the
// ask→reply→parse→stored loop end-to-end before a single real customer is
// texted. When live, the customer send still passes the CUSTOMER_FACING_ENABLED
// gate (defense-in-depth).
//
// Signal in:  AVAILABILITY_REQUEST { job_id, customer_phone, first_name,
//                                    appliance_type, warranty_company, customer_id }
// Records:    availability_requested_<job_id>  (so inbound_customer_sms routes
//             the reply to the parser)
import { config } from '../config.js';

const SITE = (config.publicSiteBase || 'https://tnapplianceexchange.net').replace(/\/+$/, '');

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  // MINIMAL TEXT (Teddy 2026-07-08): proactive intake/availability nudges are OFF — the
  // bounded 4-step sequence in intake-collector owns ALL proactive customer texting now
  // (2 intake + 2 availability, then reactive-only). Flip LOOP_INTAKE_NUDGES=on to re-enable.
  if (String(process.env.LOOP_INTAKE_NUDGES || '').toLowerCase() !== 'on') {
    return { success: true, action: 'disabled_minimal_text' };
  }
  const p = signal.payload || {};
  const jobId = Number(p.job_id || 0);

  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'availability_request_handled', { outcome: 'no_job_id' });
    return { success: false, action: 'no_job_id' };
  }

  // Skip vendor-locked (pre-scheduled) jobs.
  if (/squaretrade|servicepower|service power/i.test(String(p.warranty_company || ''))) {
    const meta = { job_id: jobId, outcome: 'skipped_vendor_locked' };
    await xano.markSignalProcessed(signal.id, 'availability_request_handled', meta);
    log('availability_request_handled', meta);
    return { success: true, action: 'skipped_vendor_locked' };
  }

  // Never ask a job that's already scheduled, finished, or canceled — Danielle
  // caught us texting closed/complete customers to "schedule" (2026-06-25).
  let _job = null;
  try { const c = await xano.getTechAssignmentContext(jobId, 0); _job = c && c.job; } catch (_) {}
  if (_job) {
    const ss = String(_job.scheduling_status || '').toLowerCase();
    if (['scheduled', 'completed', 'canceled', 'cancelled', 'in_progress', 'no_fix_possible', 'closed', 'booked'].includes(ss)) {
      const meta = { job_id: jobId, outcome: `skipped_status_${ss}` };
      await xano.markSignalProcessed(signal.id, 'availability_request_handled', meta);
      log('availability_request_handled', meta);
      return { success: true, action: meta.outcome, job_id: jobId };
    }
  }

  // Ask once per job.
  try {
    const prior = await xano.getEventLogByAction(`availability_requested_${jobId}`).catch(() => null);
    if (prior && prior.exists) {
      const meta = { job_id: jobId, outcome: 'already_asked' };
      await xano.markSignalProcessed(signal.id, 'availability_request_handled', meta);
      return { success: true, action: 'already_asked' };
    }
  } catch (_) {}

  const customerPhone = String(p.customer_phone || p.phone || '').trim();
  if (!customerPhone) {
    const meta = { job_id: jobId, outcome: 'no_phone' };
    await xano.markSignalProcessed(signal.id, 'availability_request_handled', meta);
    log('availability_request_handled', meta);
    return { success: true, action: 'no_phone' };
  }

  const first = (String(p.first_name || p.customer_name || '').trim().split(/\s+/)[0]) || 'there';
  const appliance = String(p.appliance_type || 'appliance').toLowerCase();
  // Warranty → the new light page; cash → the old flow. (Teddy 2026-07-07)
  const isWarranty = !!String(p.warranty_company || '').trim() || String(p.customer_type || '').toLowerCase() === 'warranty';
  const link = isWarranty ? `${SITE}/warranty-intake.html?job_id=${jobId}` : `${SITE}/appliance-ai.html?job_id=${jobId}&mode=resume`;
  const body =
    `Hi ${first}, this is Ant with TN Appliance Exchange about your ${appliance} repair. ` +
    `To get a tech out as fast as possible — what days/times work best for you, and are there any days/times you absolutely can't do? ` +
    `The more open you are, the sooner we can get there. ` +
    `Reply right here, or tap to tell us: ${link}`;

  const live = String(process.env.AVAILABILITY_ASK_LIVE || '').toLowerCase() === 'true';
  let sendResult;
  if (live) {
    sendResult = await xano.sendSms(customerPhone, body, {
      recipient_role: 'customer', action: 'availability_request',
      job_id: jobId, company_id: config.companyId,
    }).catch((e) => ({ success: false, error: String(e.message || e) }));
  } else {
    sendResult = await xano.sendSms(config.ownerPhone, `[test→would text ${customerPhone}] ${body}`, {
      recipient_role: 'owner', action: 'availability_request_test',
      job_id: jobId, company_id: config.companyId,
    }).catch((e) => ({ success: false, error: String(e.message || e) }));
  }

  // Mark the pending request so the inbound router treats the next reply from
  // this customer as their availability answer.
  try {
    await xano.recordEvent(`availability_requested_${jobId}`, {
      job_id: jobId, customer_phone: customerPhone, live, at_ms: Date.now(),
    });
  } catch (_) {}

  const meta = {
    job_id: jobId,
    outcome: live ? 'asked_customer' : 'asked_test_owner',
    sms: (sendResult && sendResult.success) ? 'ok' : 'failed',
  };
  await xano.markSignalProcessed(signal.id, 'availability_request_handled', meta);
  log('availability_request_handled', meta);
  return { success: true, action: meta.outcome, job_id: jobId };
}
