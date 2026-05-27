// Handles PRE_APPOINTMENT_CHECK signals (emitted by appointment_scheduled.js
// with deadline = scheduled_start - 30min). Hold-and-re-emit pattern.
//
// At deadline: check whether the tech has acknowledged the upcoming
// appointment (tapped 🚗 On My Way → tech_en_route_at != null) OR
// the customer cancelled. If neither, SMS the tech a heads-up + Teddy
// an early-warning.
//
// Closes the "tech doesn't realize they have an appointment" gap. Today
// the only tech-direction signal pre-appointment is the morning
// DAILY_TECH_BRIEFING (7am CT). Between 7am and appointment time the
// tech is on their own to read the calendar. This puts a 30-min
// proactive nudge in their texts.
import { config } from '../config.js';
import { normalizeE164, toTech, toOwner } from '../sms.js';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

function fmtTimeCT(ms) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(Number(ms))).toLowerCase().replace(/\s/g, '');
  } catch { return ''; }
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const scheduledStartMs = Number(payload.scheduled_start_ms || 0);
  const deadlineMs = Number(payload.deadline_ms || payload.scheduled_for_ms || 0);
  const technicianId = Number(payload.technician_id || 0);

  if (!jobId || !scheduledStartMs || !deadlineMs) {
    await xano.markSignalProcessed(signal.id, 'pre_appointment_check_handled', {
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
    const counts = await xano.countPendingSignalsForJob('PRE_APPOINTMENT_CHECK', jobId);
    if (counts && counts.pending_count > 1) {
      log('dedup_skip_reemit', { job_id: jobId, pending_count: counts.pending_count, type: 'PRE_APPOINTMENT_CHECK' });
      await xano.markSignalProcessed(signal.id, 'pre_appointment_check_handled', {
        job_id: jobId, outcome: 'dedup_skip_reemit', pending_count: counts.pending_count,
      });
      return { success: true, action: 'dedup_skip_reemit', job_id: jobId };
    }
  } catch (e) {
    log('dedup_check_failed', { job_id: jobId, type: 'PRE_APPOINTMENT_CHECK', error: String(e.message || e) });
  }

    try {
      await xano.emitSignal({
        signal_type: 'PRE_APPOINTMENT_CHECK',
        signal_strength: 60,
        payload,
      });
    } catch (err) {
      log('pre_appointment_check_hold_failed', { job_id: jobId, error: String(err.message || err) });
    }
    const meta = { job_id: jobId, outcome: 'held_until_deadline', deadline_ms: deadlineMs };
    await xano.markSignalProcessed(signal.id, 'pre_appointment_check_handled', meta);
    return { success: true, action: 'held_until_deadline', job_id: jobId };
  }

  // Pull current job + tech state
  let ctxData = null;
  try {
    ctxData = await xano.getTechAssignmentContext(jobId, technicianId);
  } catch (err) {
    log('pre_appointment_check_context_failed', { job_id: jobId, error: String(err.message || err) });
  }
  const job = (ctxData && ctxData.job) || null;
  const tech = (ctxData && ctxData.tech) || null;
  const customer = (ctxData && ctxData.customer) || null;

  if (!job) {
    const meta = { job_id: jobId, outcome: 'context_failed' };
    await xano.markSignalProcessed(signal.id, 'pre_appointment_check_handled', meta);
    return { success: false, action: 'context_failed' };
  }

  const status = String(job.scheduling_status || '').toLowerCase();
  if (status === 'canceled' || status === 'completed' || status === 'in_progress') {
    const meta = { job_id: jobId, outcome: `skipped_status_${status}` };
    await xano.markSignalProcessed(signal.id, 'pre_appointment_check_handled', meta);
    log('pre_appointment_check_handled', meta);
    return { success: true, action: meta.outcome, job_id: jobId };
  }

  // If reschedule fired, the new APPOINTMENT_SCHEDULED already emitted a
  // fresh PRE_APPOINTMENT_CHECK for the new time. Drop this stale one.
  const currentStart = Number(job.scheduled_start || 0);
  if (currentStart !== scheduledStartMs) {
    const meta = {
      job_id: jobId,
      outcome: 'skipped_rescheduled',
      original_start_ms: scheduledStartMs,
      current_start_ms: currentStart,
    };
    await xano.markSignalProcessed(signal.id, 'pre_appointment_check_handled', meta);
    log('pre_appointment_check_handled', meta);
    return { success: true, action: 'skipped_rescheduled', job_id: jobId };
  }

  // Already on the way → clean skip
  if (job.tech_en_route_at != null && Number(job.tech_en_route_at) > 0) {
    const meta = { job_id: jobId, outcome: 'tech_already_en_route', en_route_at: job.tech_en_route_at };
    await xano.markSignalProcessed(signal.id, 'pre_appointment_check_handled', meta);
    log('pre_appointment_check_handled', meta);
    return { success: true, action: 'tech_already_en_route', job_id: jobId };
  }

  // Compose nudge SMS
  const apptStr = fmtTimeCT(scheduledStartMs);
  const techFirst = String(tech && tech.first_name || '').trim() || 'hey';
  const custFirst = String(customer && customer.first_name || '').trim() || 'the customer';
  const appliance = String(job.appliance_type || 'appliance').toLowerCase();
  const domain = bareDomain();

  // Tech SMS
  let techSms = null;
  const techPhone = normalizeE164(tech && tech.phone);
  if (techPhone) {
    const techBody =
      `[ant] ${techFirst} — heads up: ${custFirst}'s ${appliance} at ${apptStr} CT. ` +
      `Tap 🚗 On My Way when you head out: ${domain}/tech-ant-live.html?job_id=${jobId}&tech_id=${technicianId}`;
    try {
      techSms = await toTech(techPhone, techBody, {
        action: 'pre_appointment_tech_nudge',
        job_id: jobId,
        technician_id: technicianId,
        scheduled_start_ms: scheduledStartMs,
        source_signal_id: signal.id,
      });
    } catch (err) {
      techSms = { success: false, error: String(err.message || err) };
    }
  }

  // Owner alert (lighter weight — Teddy only, not Danielle)
  let ownerSms = null;
  const ownerBody =
    `[ant] heads up: tech ${techFirst} hasn't tapped On My Way for ` +
    `job #${jobId} at ${apptStr} CT (${custFirst}, ${appliance}).`;
  try {
    ownerSms = await toOwner(ownerBody, {
      action: 'pre_appointment_owner_alert',
      job_id: jobId,
      technician_id: technicianId,
      scheduled_start_ms: scheduledStartMs,
      source_signal_id: signal.id,
    });
  } catch (err) {
    ownerSms = { success: false, error: String(err.message || err) };
  }

  const meta = {
    job_id: jobId,
    outcome: 'tech_nudged',
    tech_sms: techSms && techSms.success ? 'ok' : (techPhone ? 'maybe_failed' : 'no_phone'),
    owner_sms: ownerSms && ownerSms.success ? 'ok' : 'maybe_failed',
    scheduled_start_ms: scheduledStartMs,
  };
  await xano.markSignalProcessed(signal.id, 'pre_appointment_check_handled', meta);
  log('pre_appointment_check_handled', meta);

  return { success: true, action: 'tech_nudged', job_id: jobId };
}
