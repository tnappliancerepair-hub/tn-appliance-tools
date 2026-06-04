// reschedule_call_due — fires when system needs to reschedule a customer
// AND voice contact is preferred (vs SMS-only).
//
// Triggered by RESCHEDULE_CALL_DUE signal, emitted by:
//   - reschedule_job_POST.xs when the rescheduler explicitly asks for
//     voice contact (via reason field starting "voice:" or similar flag)
//   - sick_day_cascade when a tech is marked out for the day
//   - parts-delay handler when parts didn't arrive
//   - Other operator-initiated paths
//
// Payload:
//   { job_id, scheduled_start_ms (new), reason_short_human, original_time_human }

import * as xano from '../xano.js';
import { placeOutboundCall, ASSISTANT_IDS } from '../vapi-out.js';

function fmtCTtime(ms) {
  if (!ms) return '';
  return new Date(Number(ms)).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function fmtDay(ms) {
  if (!ms) return '';
  const dayName = new Date(Number(ms)).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'long' });
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'long' });
  const tomorrow = new Date(Date.now() + 24*3600*1000).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'long' });
  if (dayName === now) return 'today';
  if (dayName === tomorrow) return 'tomorrow';
  return dayName;
}

export async function run(signal, ctx) {
  const { log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const reasonShort = String(payload.reason_short_human || 'something came up on our end').trim();
  const originalMs = Number(payload.original_scheduled_start_ms || payload.scheduled_start_ms || 0);

  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'reschedule_call_handled', {
      outcome: 'skipped_missing_job_id',
    });
    return { success: false };
  }

  // Time-of-day gate
  const hourCT = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date()), 10);
  if (!(Number.isFinite(hourCT) && hourCT >= 9 && hourCT < 19)) {
    await xano.markSignalProcessed(signal.id, 'reschedule_call_handled', {
      outcome: 'skipped_outside_business_hours',
      hour_ct: hourCT,
    });
    return { success: true, action: 'skipped_outside_business_hours' };
  }

  // Load context
  let ctxData = null;
  try {
    ctxData = await xano.getTechAssignmentContext(jobId, 0);
  } catch (err) {
    log('reschedule_call_context_failed', { job_id: jobId, error: String(err.message || err) });
  }
  const job = ctxData && ctxData.job;
  const customer = ctxData && ctxData.customer;
  if (!job || !customer || !customer.phone) {
    await xano.markSignalProcessed(signal.id, 'reschedule_call_handled', {
      outcome: 'skipped_no_phone',
      job_id: jobId,
    });
    return { success: true, action: 'skipped_no_phone' };
  }

  const region = String(job.service_state || '').toLowerCase().startsWith('la') ? 'LA' : 'TN';
  const firstName = String(customer.first_name || '').trim() || 'there';
  const appliance = String(job.appliance_type || 'appliance').toLowerCase();

  const variableValues = {
    customer_first_name: firstName,
    appliance_type: appliance,
    original_day_human: fmtDay(originalMs) || 'the day we had you scheduled',
    reason_short_human: reasonShort,
    job_id: String(jobId),
  };

  const voiceRes = await placeOutboundCall({
    assistantId: ASSISTANT_IDS.reschedule,
    toPhone: customer.phone,
    fromRegion: region,
    variableValues,
    metadata: {
      source: 'reschedule_call_due_auto',
      job_id: jobId,
      reason_short_human: reasonShort,
      attempt_number: 1,
      retry_eligible: true,
      assistant_id: ASSISTANT_IDS.reschedule,
      from_region: region,
      variable_values: variableValues,
    },
  });

  const meta = {
    job_id: jobId,
    outcome: voiceRes && voiceRes.ok ? 'reschedule_call_placed' : 'reschedule_call_failed',
    voice_call_id: voiceRes && voiceRes.call_id ? voiceRes.call_id : null,
    voice_error: voiceRes && !voiceRes.ok ? voiceRes.error : null,
  };
  await xano.markSignalProcessed(signal.id, 'reschedule_call_handled', meta);
  log('reschedule_call_handled', meta);

  return { success: true, action: meta.outcome };
}
