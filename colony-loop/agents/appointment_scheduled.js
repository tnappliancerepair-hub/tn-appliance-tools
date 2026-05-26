import { config } from '../config.js';
import { fmtCT } from '../time.js';
import { normalizeE164 } from '../sms.js';

// Sources that should NOT trigger a customer confirmation. tech_claim is
// the open-broadcast "yes" path which defaults scheduled_start to tomorrow
// 8am — that's a placeholder, not a real customer-facing appointment. The
// office still needs to book a real time before notifying the customer.
const SKIP_CUSTOMER_SOURCES = new Set(['tech_claim']);

// Sources where the tech doesn't need a confirmation SMS (they did the
// action themselves). Office-driven and external-driven sources get the
// tech SMS so the tech sees "ant confirms" on their phone.
const SKIP_TECH_SOURCES = new Set(['tech_claim', 'tech_pick', 'tech_reschedule']);

const APPLIANCE_NICE = {
  refrigerator: 'refrigerator',
  fridge: 'refrigerator',
  washer: 'washer',
  dryer: 'dryer',
  dishwasher: 'dishwasher',
  range: 'range',
  oven: 'oven',
  stove: 'stove',
  microwave: 'microwave',
};

function fmtAppointment(startMs, endMs) {
  if (!startMs) return '(time tbd)';
  const startStr = new Date(Number(startMs)).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  if (endMs && Number(endMs) > Number(startMs)) {
    const endTime = new Date(Number(endMs)).toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${startStr} – ${endTime}`;
  }
  return startStr;
}

function applianceLabel(raw) {
  const k = String(raw || '').toLowerCase().trim();
  return APPLIANCE_NICE[k] || k || 'appliance';
}

function customerBody({ first, appliance, apptStr, techFirst }) {
  const name = (first || '').trim() || 'there';
  const techClause = techFirst ? `Your tech will be ${techFirst}.` : '';
  return [
    `Hi ${name}, your ${appliance} repair is confirmed for ${apptStr}.`,
    techClause,
    `Reply STOP to cancel or call 615-280-2949.`,
  ].filter(Boolean).join(' ');
}

function techBody({ jobLabel, apptStr, custName, address }) {
  const addrClause = address ? ` - ${address}` : '';
  return `[ant] job #${jobLabel} confirmed for ${apptStr} - ${custName}${addrClause}`;
}

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const payload = signal.payload || {};

  const jobId = Number(payload.job_id);
  const scheduledStartMs = Number(payload.scheduled_start_ms) || 0;
  const scheduledEndMs = payload.scheduled_end_ms ? Number(payload.scheduled_end_ms) : null;
  const technicianId = Number(payload.technician_id) || 0;
  const source = String(payload.source || '').toLowerCase();

  if (!jobId) throw new Error('payload.job_id required');
  if (!scheduledStartMs) {
    log('appointment_scheduled_skipped_no_time', { job_id: jobId, source });
    return { success: true, action: 'skipped_no_time', job_id: jobId };
  }

  // Dedup: same job_id + scheduled_start_ms already confirmed → skip.
  let handled = null;
  try {
    handled = await xano.getAppointmentConfirmationSent(jobId, scheduledStartMs);
  } catch (err) {
    log('appointment_scheduled_dedup_check_failed', { job_id: jobId, error: err.message });
    // Fail-open on dedup query failures — better to risk a rare duplicate
    // than swallow a real confirmation.
  }
  if (handled && handled.sent) {
    log('appointment_scheduled_skipped_duplicate', {
      job_id: jobId,
      scheduled_start_ms: scheduledStartMs,
      last_sent_at: handled.last_sent_at,
    });
    return {
      success: true,
      action: 'skipped_duplicate',
      job_id: jobId,
      scheduled_start_ms: scheduledStartMs,
    };
  }

  // Load context. Reuses the same endpoint that backs Phase 5.5A.1.
  let ctxData;
  try {
    ctxData = await xano.getTechAssignmentContext(jobId, technicianId || 1);
  } catch (err) {
    log('appointment_scheduled_context_load_failed', { job_id: jobId, error: err.message });
    return { success: false, action: 'context_load_failed', job_id: jobId, error: err.message };
  }
  if (!ctxData || !ctxData.success) {
    log('appointment_scheduled_context_load_failed', {
      job_id: jobId,
      error: ctxData?.error || 'unknown',
    });
    return { success: false, action: 'context_load_failed', job_id: jobId };
  }
  const job = ctxData.job || {};
  const customer = ctxData.customer || null;
  const tech = ctxData.tech || null;
  const jobLabel = job.job_number || String(job.id);
  const appliance = applianceLabel(job.appliance_type);
  const apptStr = fmtAppointment(scheduledStartMs, scheduledEndMs);

  const custFirst = (customer?.first_name || '').trim();
  const custLast = (customer?.last_name || '').trim();
  const custName = `${custFirst} ${custLast}`.trim() || '(no customer)';
  const custPhone = normalizeE164(customer?.phone);
  const techFirst = (tech?.first_name || '').trim();
  const techPhone = normalizeE164(tech?.phone);

  const addressParts = [job.service_address, job.service_city, job.service_state]
    .filter((p) => p && String(p).trim());
  const address = addressParts.join(', ');

  // Customer SMS — gated by source + valid phone.
  let custResult = 'skipped';
  if (SKIP_CUSTOMER_SOURCES.has(source)) {
    custResult = 'skipped_source';
  } else if (!custPhone) {
    custResult = 'skipped_invalid_phone';
  } else {
    const body = customerBody({ first: custFirst, appliance, apptStr, techFirst });
    const res = await sms.toCustomer(custPhone, body, {
      action: 'appointment_confirmation',
      job_id: jobId,
      scheduled_start_ms: scheduledStartMs,
      source,
    });
    custResult = res && res.success ? 'ok' : 'maybe_failed';
  }

  // Tech SMS — gated by source + valid phone.
  let techResult = 'skipped';
  if (SKIP_TECH_SOURCES.has(source)) {
    techResult = 'skipped_source';
  } else if (!techPhone) {
    techResult = 'skipped_invalid_phone';
  } else {
    const body = techBody({ jobLabel, apptStr, custName, address });
    const res = await sms.toTech(techPhone, body, {
      action: 'appointment_confirmation_tech',
      job_id: jobId,
      scheduled_start_ms: scheduledStartMs,
      source,
    });
    techResult = res && res.success ? 'ok' : 'maybe_failed';
  }

  const meta = {
    job_id: jobId,
    scheduled_start_ms: scheduledStartMs,
    technician_id: technicianId,
    source,
    customer_sms: custResult,
    tech_sms: techResult,
  };
  await xano.markSignalProcessed(signal.id, 'appointment_confirmation_sent', meta);
  log('appointment_confirmation_sent', meta);

  return {
    success: true,
    action: 'appointment_confirmation_sent',
    job_id: jobId,
    customer_sms: custResult,
    tech_sms: techResult,
  };
}
