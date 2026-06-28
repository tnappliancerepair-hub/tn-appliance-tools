import { config } from '../config.js';
import { fmtCT } from '../time.js';
import { normalizeE164 } from '../sms.js';

const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000; // 24h before appointment
const MIN_LEAD_MS = 60 * 60 * 1000; // don't bother if the appointment is <1h away

// Sources that should NOT trigger a customer confirmation. tech_claim is
// the open-broadcast "yes" path which defaults scheduled_start to tomorrow
// 8am — that's a placeholder, not a real customer-facing appointment. The
// office still needs to book a real time before notifying the customer.
const SKIP_CUSTOMER_SOURCES = new Set(['tech_claim']);

// Sources where the tech doesn't need a confirmation SMS here. tech_* did the
// action themselves; 'auto_place' sends its own warm heads-up from the
// autopilot (job_intake_complete) so we suppress the generic one to avoid a
// double-text. Other office/external sources still get the "ant confirms" text.
const SKIP_TECH_SOURCES = new Set(['tech_claim', 'tech_pick', 'tech_reschedule', 'auto_place']);

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

// DAY ONLY — we run day-of routing, NOT clock-time appointments. The stored
// scheduled_start time-of-day is a routing placeholder, never a promise to the
// customer (Danielle 2026-06-26: customers were getting told a specific "3:00 PM"
// that didn't match what was arranged). The real window is texted the morning of.
function fmtAppointment(startMs) {
  if (!startMs) return '(day tbd)';
  return new Date(Number(startMs)).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function applianceLabel(raw) {
  const k = String(raw || '').toLowerCase().trim();
  return APPLIANCE_NICE[k] || k || 'appliance';
}

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

function customerBody({ first, appliance, apptStr, techFirst, portalUrl }) {
  const name = (first || '').trim() || 'there';
  // Only name a tech when one is FIRMLY assigned — never guess a name (Danielle
  // 2026-06-26: customers were told a tech who wasn't actually on the job).
  const techClause = techFirst ? `Your tech will be ${techFirst}.` : '';
  const portalClause = portalUrl ? `View/reschedule: ${portalUrl}` : '';
  return [
    `Hi ${name}, your ${appliance} repair is set for ${apptStr}.`,
    techClause,
    `We'll text you a live arrival window the morning of.`,
    portalClause,
    `Reply STOP to cancel or call 866-268-0111.`,
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
  const apptStr = fmtAppointment(scheduledStartMs);

  const custFirst = (customer?.first_name || '').trim();
  const custLast = (customer?.last_name || '').trim();
  const custName = `${custFirst} ${custLast}`.trim() || '(no customer)';
  const custPhone = normalizeE164(customer?.phone);
  // Only name the tech when one is actually assigned on this schedule action.
  // Without this guard the context loader falls back to tech #1 (Teddy) or a
  // suggestion, and the customer gets told the wrong person.
  const techFirst = technicianId > 0 ? (tech?.first_name || '').trim() : '';
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
    const last4 = String(custPhone).replace(/\D/g, '').slice(-4);
    const portalUrl = last4
      ? `https://${bareDomain()}/customer-portal.html?job_id=${jobId}&last4=${last4}`
      : '';
    const body = customerBody({ first: custFirst, appliance, apptStr, techFirst, portalUrl });
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

  // ── Chain: APPOINTMENT_REMINDER_DUE (24h pre-appointment) ──
  // Skip the reminder when:
  //   - we have no scheduled_start, or
  //   - the appointment is less than 1h away (no time for a useful reminder),
  //   - the customer was the one driving the schedule action (tech_claim
  //     placeholder time — same SKIP_CUSTOMER_SOURCES set as confirmation).
  const now = Date.now();
  const reminderDeadlineMs = Number(scheduledStartMs) - REMINDER_LEAD_MS;
  const apptLeadMs = Number(scheduledStartMs) - now;
  if (
    scheduledStartMs &&
    apptLeadMs >= MIN_LEAD_MS &&
    !SKIP_CUSTOMER_SOURCES.has(source)
  ) {
    try {
      await xano.emitSignal({
        signal_type: 'APPOINTMENT_REMINDER_DUE',
        signal_strength: 45,
        payload: {
          job_id: jobId,
          scheduled_start_ms: scheduledStartMs,
          deadline_ms: Math.max(reminderDeadlineMs, now + MIN_LEAD_MS),
          scheduled_for_ms: Math.max(reminderDeadlineMs, now + MIN_LEAD_MS),
          technician_id: technicianId,
          source: 'appointment_scheduled_chain',
          source_signal_id: signal.id,
        },
      });
    } catch (err) {
      log('appointment_reminder_emit_failed', { job_id: jobId, error: String(err.message || err) });
    }
  }

  // ── Chain: UPSELL_DUE (24h pre-appointment, multi-appliance upsell) ──
  // Skip warranty jobs (already covered, no upsell pitch). Self-pay only.
  const UPSELL_LEAD_MS = 24 * 60 * 60 * 1000;
  const customerType = String(job.customer_type || '').toLowerCase();
  if (
    scheduledStartMs &&
    apptLeadMs >= MIN_LEAD_MS &&
    !SKIP_CUSTOMER_SOURCES.has(source) &&
    (customerType === 'self_pay' || customerType === 'cash' || customerType === 'customer_pay')
  ) {
    const upsellDeadlineMs = Math.max(Number(scheduledStartMs) - UPSELL_LEAD_MS, now + MIN_LEAD_MS);
    try {
      await xano.emitSignal({
        signal_type: 'UPSELL_DUE',
        signal_strength: 35,
        payload: {
          job_id: jobId,
          customer_phone: customer?.phone || '',
          first_name: customer?.first_name || '',
          tech_first: tech?.first_name || '',
          appliance_type: job.appliance_type || '',
          scheduled_start_ms: scheduledStartMs,
          deadline_ms: upsellDeadlineMs,
          scheduled_for_ms: upsellDeadlineMs,
          source: 'appointment_scheduled_chain',
          source_signal_id: signal.id,
        },
      });
    } catch (err) {
      log('upsell_due_emit_failed', { job_id: jobId, error: String(err.message || err) });
    }
  }

  // ── Chain: PRE_APPOINTMENT_CHECK (30min pre-appointment) ──
  // Verifies the tech has tapped 🚗 On My Way. If not, SMS them a nudge
  // + Teddy a heads-up. Skip for appointments <2h away (less than 1h
  // lead between now and deadline makes the nudge less useful).
  const PRE_APPT_LEAD_MS = 30 * 60 * 1000;
  if (
    scheduledStartMs &&
    apptLeadMs >= 2 * 60 * 60 * 1000 &&
    !SKIP_CUSTOMER_SOURCES.has(source) &&
    technicianId > 0
  ) {
    const preApptDeadlineMs = Math.max(Number(scheduledStartMs) - PRE_APPT_LEAD_MS, now + MIN_LEAD_MS);
    try {
      await xano.emitSignal({
        signal_type: 'PRE_APPOINTMENT_CHECK',
        signal_strength: 60,
        payload: {
          job_id: jobId,
          technician_id: technicianId,
          scheduled_start_ms: scheduledStartMs,
          deadline_ms: preApptDeadlineMs,
          scheduled_for_ms: preApptDeadlineMs,
          source: 'appointment_scheduled_chain',
          source_signal_id: signal.id,
        },
      });
    } catch (err) {
      log('pre_appointment_check_emit_failed', { job_id: jobId, error: String(err.message || err) });
    }
  }

  // ── Chain: WAIVER_DUE (4h pre-appointment) ──
  // Vision step 3: every appointment gets a waiver SMS automatically
  // 4h before tech rolls (or immediately if appointment is <4h away).
  // The agent re-checks waiver_signed before sending, so re-emits are
  // safe. Skip non-customer-driven sources that don't represent a real
  // customer-confirmed appointment (same set as confirmation).
  const WAIVER_LEAD_MS = 4 * 60 * 60 * 1000;
  if (
    scheduledStartMs &&
    apptLeadMs >= MIN_LEAD_MS &&
    !SKIP_CUSTOMER_SOURCES.has(source)
  ) {
    const waiverDeadlineMs = Math.max(Number(scheduledStartMs) - WAIVER_LEAD_MS, now + MIN_LEAD_MS);
    try {
      await xano.emitSignal({
        signal_type: 'WAIVER_DUE',
        signal_strength: 50,
        payload: {
          job_id: jobId,
          scheduled_start_ms: scheduledStartMs,
          deadline_ms: waiverDeadlineMs,
          scheduled_for_ms: waiverDeadlineMs,
          source: 'appointment_scheduled_chain',
          source_signal_id: signal.id,
        },
      });
    } catch (err) {
      log('waiver_due_emit_failed', { job_id: jobId, error: String(err.message || err) });
    }
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
