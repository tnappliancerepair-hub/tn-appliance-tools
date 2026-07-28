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
import { placeOutboundCall, ASSISTANT_IDS } from '../vapi-out.js';

const APPLIANCE_NICE = {
  refrigerator: 'refrigerator', fridge: 'refrigerator', washer: 'washer',
  dryer: 'dryer', dishwasher: 'dishwasher', range: 'range', oven: 'oven',
  stove: 'stove', microwave: 'microwave',
};

function fmtWindowCT(startMs) {
  if (!startMs) return '';
  const startStr = new Date(Number(startMs)).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    // NO exact time — TN runs day-of routing. Telling a customer a specific time made
    // them expect the tech at that minute and get angry when routing shifted (Jimmy
    // 7/6: "stop the approximate time messages"). The live window is texted the morning of.
    weekday: 'long', month: 'long', day: 'numeric',
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
    ? ` Manage or reschedule: https://${bareDomain}/customer-portal.html?job_id=${jobId}&last4=${last4}`
    : '';
  const body =
    `Hi ${firstName} - reminder: ${techName} is coming tomorrow for your ${appliance}. ` +
    `We'll text you a live arrival window in the morning. Reply RESCHEDULE if you need to move it.${portalClause}`;

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

  // TEXT-FIRST (Teddy 2026-07-28): the reminder is a TEXT. We do NOT auto-call
  // alongside it — most reminder calls today hit voicemail/full mailboxes (17 calls,
  // ~2 real answers) and just dragged the phone score. Default = OFF (text only).
  // The "call only if they don't reply" follow-up is handled separately, not here.
  // Set APPOINTMENT_REMINDER_VOICE_ENABLED=true to restore the old simultaneous call.
  let voiceRes = null;
  const voiceEnabled = (process.env.APPOINTMENT_REMINDER_VOICE_ENABLED || 'false').toLowerCase() === 'true';
  if (voiceEnabled) {
    const region = String(job.service_state || '').toLowerCase().startsWith('la') ? 'LA' : 'TN';
    // Day-of routing: pass DAY ONLY, not time. Customer hears
    // "your repair tomorrow with Jimmy" not "your repair at 10am".
    // Compute the day name in CT for human-friendly phrasing.
    const scheduledDayName = new Date(Number(scheduledStartMs)).toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'long',
    });
    const nowCT = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'long' });
    const tomorrowCT = new Date(Date.now() + 24*3600*1000).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'long' });
    let scheduledDayHuman = scheduledDayName;
    if (scheduledDayName === nowCT) scheduledDayHuman = 'today';
    else if (scheduledDayName === tomorrowCT) scheduledDayHuman = 'tomorrow';

    // CALL GATE (Teddy + John, 2026-06-23): only place the reminder CALL during
    // the day (9am-7pm CT) and only for a genuinely upcoming appointment. Skip
    // if it's 'today' or the tech is already en route / on-site — that's what
    // made Ant ring John's customer while he was standing there, and what dialed
    // customers at 9-10pm. The SMS reminder already went out above regardless.
    const callHourCT = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date()), 10);
    const inCallWindow = Number.isFinite(callHourCT) && callHourCT >= 9 && callHourCT < 19;
    const techMoving = !!(job.tech_en_route_at || job.job_started_at);
    const callSkip = !inCallWindow ? 'after_hours'
      : (scheduledDayHuman === 'today' ? 'today_or_in_progress'
      : (techMoving ? 'tech_en_route' : ''));
    if (callSkip) {
      voiceRes = { ok: false, error: 'skipped_' + callSkip };
    } else {
    try {
      const vars = {
        customer_first_name: firstName,
        appliance_type: appliance,
        scheduled_day_human: scheduledDayHuman,
        tech_first_name: techName,
        job_id: String(jobId),
      };
      voiceRes = await placeOutboundCall({
        assistantId: ASSISTANT_IDS.appointment_reminder,
        toPhone: phone,
        fromRegion: region,
        variableValues: vars,
        metadata: {
          source: 'appointment_reminder_due_auto',
          job_id: jobId,
          scheduled_start_ms: scheduledStartMs,
          attempt_number: 1,
          retry_eligible: true,
          assistant_id: ASSISTANT_IDS.appointment_reminder,
          from_region: region,
          variable_values: vars,
        },
      });
    } catch (err) {
      voiceRes = { ok: false, error: String(err.message || err) };
    }
    }
  }

  const meta = {
    job_id: jobId,
    outcome: smsRes && smsRes.success ? 'reminder_sent' : 'send_failed',
    scheduled_start_ms: scheduledStartMs,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    voice_enabled: voiceEnabled,
    voice_result: voiceRes && voiceRes.ok ? 'ok' : (voiceRes ? (voiceRes.error || 'failed') : 'skipped'),
    voice_call_id: voiceRes && voiceRes.call_id ? voiceRes.call_id : null,
  };
  await xano.markSignalProcessed(signal.id, 'appointment_reminder_handled', meta);
  log('appointment_reminder_handled', meta);

  return { success: true, action: meta.outcome, job_id: jobId };
}
