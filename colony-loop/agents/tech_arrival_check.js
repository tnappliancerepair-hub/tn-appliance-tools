// Handles TECH_ARRIVAL_CHECK signals. Uses the hold-and-re-emit pattern:
// if Date.now() < scheduled_for_ms, re-emit the same signal with the
// same payload (still holding); otherwise wake up + check.
//
// On wake-up:
//   - Query jobs.job_started_at for the target job
//   - If set: tech arrived + tapped Start Job → silent skip (success)
//   - If null + still no en-route timestamp drift: SMS Teddy
//     "[ant] ⚠️ {tech} ETA was {time}, no Start Job yet for {customer}.
//     Customer may be waiting."
//
// Dedup: each TECH_ARRIVAL_CHECK signal carries a unique check_signal_id;
// we don't need extra dedup since markSignalProcessed handles single-shot.
import { toOwner, normalizeE164 } from '../sms.js';

function fmtTimeCT(ms) {
  if (!ms) return '?';
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'America/Chicago',
    }).format(new Date(ms)).toLowerCase().replace(/\s/g, '') + ' CT';
  } catch {
    return String(ms);
  }
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const technicianId = Number(payload.technician_id || 0);
  const etaMs = Number(payload.eta_timestamp_ms || 0);
  const deadlineMs = Number(payload.deadline_ms || payload.scheduled_for_ms || 0);

  if (!jobId || !deadlineMs) {
    await xano.markSignalProcessed(signal.id, 'tech_arrival_check_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  // Hold-and-re-emit pattern: if it's not time yet, re-emit and exit.
  if (Date.now() < deadlineMs) {
    try {
      await xano.emitSignal({
        signal_type: 'TECH_ARRIVAL_CHECK',
        signal_strength: 60,
        payload, // verbatim — preserves scheduled_for_ms
      });
    } catch (err) {
      log('tech_arrival_check_hold_emit_failed', { job_id: jobId, error: String(err.message || err) });
    }
    const meta = { job_id: jobId, outcome: 'held_until_deadline', deadline_ms: deadlineMs };
    await xano.markSignalProcessed(signal.id, 'tech_arrival_check_handled', meta);
    return { success: true, action: 'held_until_deadline', job_id: jobId };
  }

  // Past the deadline — check whether tech has tapped Start Job.
  let status;
  try {
    status = await xano.getJobArrivalStatus(jobId);
  } catch (err) {
    const meta = { job_id: jobId, outcome: 'status_load_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'tech_arrival_check_handled', meta);
    log('tech_arrival_check_handled', meta);
    return { success: false, action: 'status_load_failed', job_id: jobId };
  }

  if (status && status.job_started_at) {
    const meta = {
      job_id: jobId,
      outcome: 'tech_arrived_on_time',
      job_started_at: status.job_started_at,
    };
    await xano.markSignalProcessed(signal.id, 'tech_arrival_check_handled', meta);
    log('tech_arrival_check_handled', meta);
    return { success: true, action: 'tech_arrived_on_time', job_id: jobId };
  }

  // No Start Job yet → alert Teddy.
  let techFirst = 'tech';
  try {
    const techs = await xano.getTechnicians();
    const list = (techs && techs.items) || techs || [];
    const tech = list.find((t) => t && t.id === technicianId);
    if (tech && tech.first_name) techFirst = String(tech.first_name).trim();
  } catch (err) {
    /* best-effort */
  }

  const etaStr = fmtTimeCT(etaMs);
  const body =
    `[ant] ⚠️ ${techFirst} ETA was ${etaStr}, no Start Job yet for job #${jobId}. ` +
    `Customer may be waiting.`;

  let smsRes;
  try {
    smsRes = await toOwner(body, {
      action: 'tech_arrival_late_alert',
      job_id: jobId,
      technician_id: technicianId,
      eta_timestamp_ms: etaMs,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  const meta = {
    job_id: jobId,
    technician_id: technicianId,
    outcome: 'tech_arrival_late_alert_sent',
    minutes_late: Math.floor((Date.now() - etaMs) / 60000),
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'tech_arrival_check_handled', meta);
  log('tech_arrival_check_handled', meta);

  return { success: true, action: 'tech_arrival_late_alert_sent', job_id: jobId };
}
