// Handles APPOINTMENT_REMINDER_DUE signals (emitted by appointment_scheduled.js
// with deadline_ms = scheduled_start_ms - 24h). Hold-and-re-emit pattern.
// When deadline hits, send the customer a friendly reminder SMS.
//
// Skip if:
//   - the job has since been canceled
//   - the scheduled_start has changed (reschedule fired a new
//     APPOINTMENT_SCHEDULED → new APPOINTMENT_REMINDER_DUE with new deadline,
//     so the stale signal should bow out)
//
// Dedup: reminders are dedup'd via the existing get_appointment_confirmation_sent
// pattern but on its own action — appointment_reminder_sent — so a confirmation
// and a reminder for the same (job, scheduled_start) don't collide.
import { config } from '../config.js';
import { normalizeE164, toCustomer } from '../sms.js';

const APPLIANCE_NICE = {
  refrigerator: 'refrigerator', fridge: 'refrigerator', washer: 'washer',
  dryer: 'dryer', dishwasher: 'dishwasher', range: 'range', oven: 'oven',
  stove: 'stove', microwave: 'microwave',
};

function fmtWindowCT(startMs) {
  if (!startMs) return '';
  const startStr = new Date(Number(startMs)).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  return startStr;
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const scheduledStartMs = Number(payload.scheduled_start_ms || 0);
  const deadlineMs = Number(payload.deadline_ms || payload.scheduled_for_ms || 0);

  if (!jobId || !scheduledStartMs || !deadlineMs) {
    await xano.markSignalProcessed(signal.id, 'appointment_reminder_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  // Hold-and-re-emit.
  if (Date.now() < deadlineMs) {
  // Dedup: if multiple pending signals exist for this job, skip the
  // re-emit and mark current processed. Collapses runaway dupes over a
  // few ticks back to steady-state 1 pending per job. Prevents the
  // duplicate-SMS-at-deadline bug.
  try {
    const counts = await xano.countPendingSignalsForJob('APPOINTMENT_REMINDER_DUE', jobId);
    if (counts && counts.pending_count > 1) {
      log('dedup_skip_reemit', { job_id: jobId, pending_count: counts.pending_count, type: 'APPOINTMENT_REMINDER_DUE' });
      await xano.markSignalProcessed(signal.id, 'appointment_reminder_due_handled', {
        job_id: jobId, outcome: 'dedup_skip_reemit', pending_count: counts.pending_count,
      });
      return { success: true, action: 'dedup_skip_reemit', job_id: jobId };
    }
  } catch (e) {
    log('dedup_check_failed', { job_id: jobId, type: 'APPOINTMENT_REMINDER_DUE', error: String(e.message || e) });
  }

    try {
      await xano.emitSignal({
        signal_type: 'APPOINTMENT_REMINDER_DUE',
        signal_strength: 45,
        payload,
      });
    } catch (err) {
      log('appointment_reminder_hold_failed', { job_id: jobId, error: String(err.message || err) });
    }
    const meta = { job_id: jobId, outcome: 'held_until_deadline', deadline_ms: deadlineMs };
    await xano.markSignalProcessed(signal.id, 'appointment_reminder_handled', meta);
    return { success: true, action: 'held_until_deadline', job_id: jobId };
  }

  // Pull current state — check the appointment is still on the books with
  // the same scheduled_start. If reschedule fired, a fresh signal already
  // covers the new time; we silently exit.
  let ctxData = null;
  try {
    ctxData = await xano.getTechAssignmentContext(jobId, payload.technician_id || 0);
  } catch (err) {
    log('appointment_reminder_context_failed', { job_id: jobId, error: String(err.message || err) });
  }
  const job = (ctxData && ctxData.job) || null;
  const customer = (ctxData && ctxData.customer) || null;
  const tech = (ctxData && ctxData.tech) || null;

  if (!job || !customer) {
    const meta = { job_id: jobId, outcome: 'context_load_failed' };
    await xano.markSignalProcessed(signal.id, 'appointment_reminder_handled', meta);
    return { success: false, action: 'context_load_failed' };
  }

  const currentStart = Number(job.scheduled_start || 0);
  if (currentStart !== scheduledStartMs) {
    // Reschedule happened — the new APPOINTMENT_SCHEDULED already emitted a
    // fresh APPOINTMENT_REMINDER_DUE for the new time. Drop this stale one.
    const meta = {
      job_id: jobId,
      outcome: 'skipped_rescheduled',
      original_start_ms: scheduledStartMs,
      current_start_ms: currentStart,
    };
    await xano.markSignalProcessed(signal.id, 'appointment_reminder_handled', meta);
    log('appointment_reminder_handled', meta);
    return { success: true, action: 'skipped_rescheduled', job_id: jobId };
  }

  const status = String(job.scheduling_status || '').toLowerCase();
  if (status === 'canceled' || status === 'completed' || status === 'no_fix_possible') {
    const meta = { job_id: jobId, outcome: `skipped_status_${status}`, scheduling_status: status };
    await xano.markSignalProcessed(signal.id, 'appointment_reminder_handled', meta);
    log('appointment_reminder_handled', meta);
    return { success: true, action: meta.outcome, job_id: jobId };
  }

  const phone = normalizeE164(customer.phone);
  if (!phone) {
    const meta = { job_id: jobId, outcome: 'skipped_no_phone' };
    await xano.markSignalProcessed(signal.id, 'appointment_reminder_handled', meta);
    return { success: true, action: 'skipped_no_phone' };
  }

  const firstName = String(customer.first_name || '').trim() || 'there';
  const appliance = APPLIANCE_NICE[String(job.appliance_type || '').toLowerCase()] || (job.appliance_type || 'appliance').toLowerCase();
  const apptStr = fmtWindowCT(scheduledStartMs);
  const techName = tech && tech.first_name ? String(tech.first_name).trim() : 'our tech';
  const bareDomain = (config.publicSiteBase || '').replace(/^https?:\/\//, '');
  const last4 = String(phone).replace(/\D/g, '').slice(-4);
  const portalClause = (bareDomain && last4)
    ? ` Notes/reschedule: ${bareDomain}/customer-portal.html?job_id=${jobId}&last4=${last4}`
    : '';
  const body =
    `Hi ${firstName} - reminder: ${techName} is coming tomorrow ${apptStr} CT for your ${appliance}. ` +
    `Reply RESCHEDULE if you need to move it.${portalClause}`;

  let smsRes = null;
  try {
    smsRes = await toCustomer(phone, body, {
      action: 'appointment_reminder_sent',
      job_id: jobId,
      scheduled_start_ms: scheduledStartMs,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  const meta = {
    job_id: jobId,
    outcome: smsRes && smsRes.success ? 'reminder_sent' : 'send_failed',
    scheduled_start_ms: scheduledStartMs,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'appointment_reminder_handled', meta);
  log('appointment_reminder_handled', meta);

  return { success: true, action: meta.outcome, job_id: jobId };
}
