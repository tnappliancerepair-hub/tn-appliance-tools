// Handles RESUME_NUDGE signals (emitted daily 9:30am CT by tick.js).
// For each AHS/ServicePower job with no resume-chat completion within
// the last 48h, sends the customer a one-time nudge SMS with the
// resume-chat URL pre-filled (job_id + mode=resume).
//
// Dedup per (job_id) via event_log compound action key — we only nudge
// each job once.
//
// Closes the "customer got greeting, ignored it, job stays in not_ready
// forever" gap. v1: single nudge. Future: 2nd nudge at 72h, then handoff
// to manual.
import { config } from '../config.js';
import { normalizeE164, toCustomer } from '../sms.js';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  // MINIMAL TEXT (Teddy 2026-07-08): proactive intake/availability nudges are OFF — the
  // bounded 4-step sequence in intake-collector owns ALL proactive customer texting now
  // (2 intake + 2 availability, then reactive-only). Flip LOOP_INTAKE_NUDGES=on to re-enable.
  if (String(process.env.LOOP_INTAKE_NUDGES || '').toLowerCase() !== 'on') {
    return { success: true, action: 'disabled_minimal_text' };
  }

  let payload;
  try {
    payload = await xano.getResumeChatPending();
  } catch (err) {
    log('resume_nudge_load_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'resume_nudge_handled', {
      outcome: 'load_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'load_failed' };
  }

  const jobs = (payload && payload.jobs) || [];
  if (jobs.length === 0) {
    await xano.markSignalProcessed(signal.id, 'resume_nudge_handled', {
      outcome: 'no_jobs_pending',
    });
    log('resume_nudge_handled', { outcome: 'no_jobs_pending' });
    return { success: true, action: 'no_jobs_pending', job_count: 0 };
  }

  const results = { sent: 0, skipped_dedup: 0, skipped_no_phone: 0, errors: 0 };
  const domain = bareDomain();

  for (const j of jobs) {
    const jobId = Number(j.job_id);
    if (!jobId) continue;

    // Per-job dedup
    const dedupAction = `resume_nudge_sent_${jobId}`;
    let priorSend = null;
    try {
      priorSend = await xano.getEventLogByAction(dedupAction);
    } catch (err) {
      results.errors += 1;
      continue;
    }
    if (priorSend && priorSend.exists) {
      results.skipped_dedup += 1;
      continue;
    }

    const phone = normalizeE164(j.customer_phone);
    if (!phone) {
      results.skipped_no_phone += 1;
      continue;
    }

    const first = String(j.customer_first || '').trim() || 'there';
    const appl = String(j.appliance_type || 'appliance').toLowerCase();
    const last4 = String(phone).replace(/\D/g, '').slice(-4);
    // Warranty → the new light page; cash → the old customer-portal flow. (Teddy 2026-07-07)
    const isWarranty = !!String(j.warranty_company || '').trim() || String(j.customer_type || '').toLowerCase() === 'warranty';
    const resumeUrl = isWarranty
      ? `https://${domain}/warranty-intake.html?job_id=${jobId}`
      : `https://${domain}/customer-portal.html?job_id=${jobId}&last4=${last4}`;

    const body =
      `Hi ${first} - your ${appl} repair claim is in our system but we need a few quick details ` +
      `to get you scheduled. 2 minutes — a short video, your model # + the days that work: ${resumeUrl}`;

    let smsRes = null;
    try {
      smsRes = await toCustomer(phone, body, {
        action: 'resume_nudge_sent',
        job_id: jobId,
        source_signal_id: signal.id,
      });
      results.sent += 1;
    } catch (err) {
      results.errors += 1;
      log('resume_nudge_sms_failed', { job_id: jobId, error: String(err.message || err) });
    }

    // Write dedup row
    try {
      await xano.recordEventLog(dedupAction, {
        job_id: jobId,
        customer_phone: phone,
        sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
        source_signal_id: signal.id,
      });
    } catch (err) {
      log('resume_nudge_dedup_write_failed', { job_id: jobId, error: String(err.message || err) });
    }
  }

  await xano.markSignalProcessed(signal.id, 'resume_nudge_handled', {
    outcome: 'swept',
    job_count: jobs.length,
    ...results,
  });
  log('resume_nudge_handled', { outcome: 'swept', job_count: jobs.length, ...results });

  return { success: true, action: 'swept', job_count: jobs.length, ...results };
}
