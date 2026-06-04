// tech_running_late_scan — every 30 min during business hours, scan
// for jobs where scheduled_start is 30-120 min ago AND tech hasn't
// started AND isn't en route. For each match, place an outbound Ant
// Tech Running Late call to the customer.
//
// Conservative defaults to avoid nuisance calling:
//   - 30 min minimum lateness (not "every minute behind = call")
//   - 9am-7pm CT only (no early-morning calls)
//   - Per-(job, lateness-bracket) dedup so we don't call the same
//     customer twice for the same lateness
//
// Triggered by TECH_RUNNING_LATE_SCAN signal from tick.js.

import * as xano from '../xano.js';
import { placeOutboundCall, ASSISTANT_IDS } from '../vapi-out.js';

function fmtCTtime(ms) {
  if (!ms) return '';
  return new Date(Number(ms)).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function lateBracket(minBehind) {
  // Bracket lateness so we don't call the same customer at 30 min, then
  // again at 35 min, then again at 40 min. Brackets: 30-59, 60-89, 90-120.
  if (minBehind < 60) return 30;
  if (minBehind < 90) return 60;
  return 90;
}

export async function run(signal, ctx) {
  const { log } = ctx;

  // Time-of-day gate: 9am-7pm CT
  const hourCT = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hour12: false,
  }).format(new Date()), 10);
  if (!(Number.isFinite(hourCT) && hourCT >= 9 && hourCT < 19)) {
    await xano.markSignalProcessed(signal.id, 'tech_running_late_scan_handled', {
      outcome: 'skipped_outside_business_hours',
      hour_ct: hourCT,
    });
    return { success: true, action: 'skipped_outside_business_hours' };
  }

  // Voice-enabled kill switch
  const voiceEnabled = String(process.env.TECH_RUNNING_LATE_VOICE_ENABLED || 'true').toLowerCase() !== 'false';
  if (!voiceEnabled) {
    await xano.markSignalProcessed(signal.id, 'tech_running_late_scan_handled', {
      outcome: 'skipped_disabled_by_env',
    });
    return { success: true, action: 'skipped_disabled_by_env' };
  }

  let lateJobs;
  try {
    const resp = await xano.getRunningLateJobs(30, 120);
    lateJobs = (resp && resp.items) || [];
  } catch (err) {
    await xano.markSignalProcessed(signal.id, 'tech_running_late_scan_handled', {
      outcome: 'fetch_failed',
      error: String(err.message || err).slice(0, 200),
    });
    return { success: false, action: 'fetch_failed' };
  }

  let calls_placed = 0;
  let skipped_no_phone = 0;
  let skipped_dedup = 0;
  let call_failures = 0;
  const perJobLog = [];

  for (const job of lateJobs) {
    const jobId = job.job_id;
    const phone = String(job.customer_phone || '').trim();
    const firstName = String(job.customer_first_name || '').trim() || 'there';
    const techName = String(job.tech_first_name || '').trim() || 'our tech';
    const minutesBehind = Number(job.minutes_behind || 0);
    const bracket = lateBracket(minutesBehind);

    if (!phone) {
      skipped_no_phone++;
      perJobLog.push({ job_id: jobId, outcome: 'skipped_no_phone' });
      continue;
    }

    // Dedup-by-bracket: check if the compound action already fired today.
    // The 30-min scan interval + 3 brackets (30/60/90) naturally limits
    // calls to AT MOST 3 per job per day, but per-bracket dedup ensures
    // we don't double-call if scan fires multiple times within the same
    // lateness window.
    const dedupAction = `tech_running_late_call_placed_${jobId}_${bracket}`;
    const todayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()); // YYYY-MM-DD CT
    try {
      const alreadyFired = await xano.checkEventLogFiredToday(dedupAction, todayKey);
      if (alreadyFired) {
        skipped_dedup++;
        perJobLog.push({ job_id: jobId, outcome: 'skipped_dedup', bracket });
        continue;
      }
    } catch (_) {
      // If dedup check fails, fall through and risk a dup call rather
      // than skipping all calls. Better to err on side of customer comms.
    }

    // Compute an honest "new ETA" — we don't actually know when the tech
    // will arrive. Conservative estimate: now + 30 min. The Tech Running
    // Late assistant's prompt is designed to be vague + courteous about
    // this ("running about X behind, will be there closer to [time]").
    const newEtaMs = Date.now() + 30 * 60 * 1000;
    const originalTimeHuman = fmtCTtime(job.scheduled_start_ms);
    const newEtaHuman = `around ${fmtCTtime(newEtaMs)} central time`;
    const region = String(job.service_state || '').toLowerCase().startsWith('la') ? 'LA' : 'TN';

    const variableValues = {
      customer_first_name: firstName,
      tech_first_name: techName,
      minutes_behind: String(minutesBehind),
      new_eta_human: newEtaHuman,
      original_time_human: originalTimeHuman,
      appliance_type: String(job.appliance_type || 'appliance'),
      job_id: String(jobId),
    };

    try {
      const voiceRes = await placeOutboundCall({
        assistantId: ASSISTANT_IDS.tech_running_late,
        toPhone: phone,
        fromRegion: region,
        variableValues,
        metadata: {
          source: 'tech_running_late_scan_auto',
          job_id: jobId,
          minutes_behind: minutesBehind,
          bracket,
          attempt_number: 1,
          retry_eligible: true,
          assistant_id: ASSISTANT_IDS.tech_running_late,
          from_region: region,
          variable_values: variableValues,
        },
      });
      if (voiceRes && voiceRes.ok) {
        calls_placed++;
        // Write dedup row
        try {
          await xano.recordEventLog(dedupAction, {
            job_id: jobId,
            minutes_behind: minutesBehind,
            bracket,
            vapi_call_id: voiceRes.call_id,
            customer_phone: phone,
          });
        } catch (_) {}
        perJobLog.push({ job_id: jobId, outcome: 'call_placed', bracket, vapi_call_id: voiceRes.call_id });
      } else {
        call_failures++;
        perJobLog.push({ job_id: jobId, outcome: 'call_failed', error: voiceRes && voiceRes.error });
      }
    } catch (err) {
      call_failures++;
      perJobLog.push({ job_id: jobId, outcome: 'call_error', error: String(err.message || err).slice(0, 100) });
    }
  }

  const meta = {
    outcome: 'scan_completed',
    candidates: lateJobs.length,
    calls_placed,
    skipped_no_phone,
    skipped_dedup,
    call_failures,
    hour_ct: hourCT,
  };
  await xano.markSignalProcessed(signal.id, 'tech_running_late_scan_handled', meta);
  log('tech_running_late_scan_handled', meta);
  if (perJobLog.length > 0) log('tech_running_late_scan_per_job', perJobLog);

  return { success: true, action: 'scan_completed', ...meta };
}
