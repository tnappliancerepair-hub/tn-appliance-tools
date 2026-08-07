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

// 3-HOUR ARRIVAL WINDOW — never an exact clock time (Teddy 2026-07-07: "position
// 1-6 + 3-hour slots"). A single "11am" made customers expect us to the minute
// (Jimmy + Danielle both flagged it) and cost business. A 3-hour window ("11am-2pm",
// like HCP/Dispatch) sets the right expectation and still leaves the route flexible.
// The stored hour buckets into a window; a SquareTrade/vendor-designated window on
// the job wins verbatim (their predetermined slot).
function windowFromHour(startMs) {
  if (!startMs) return '';
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date(Number(startMs))));
  if (h < 11) return '8am-11am';
  if (h < 14) return '11am-2pm';
  return '2pm-5pm';
}
function windowLabelFor(job, startMs) {
  const vendor = String((job && job.service_eta_window) || '').trim();
  if (vendor) return vendor; // SquareTrade / vendor designated window — honor as-is
  return windowFromHour(startMs);
}

function applianceLabel(raw) {
  const k = String(raw || '').toLowerCase().trim();
  return APPLIANCE_NICE[k] || k || 'appliance';
}

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

// Slot 1-8 from the stored scheduled_start (Teddy's slot model, office-board.html:
// stop position N is encoded as CT hour 8+(N-1), a hidden sort key — no clock time is
// ever shown). So slot = CT-hour - 7 (8am->1 ... 3pm->8). 0 = couldn't derive -> omit.
function slotFromStart(ms) {
  if (!ms) return 0;
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date(ms)));
  const s = h - 7;
  return (s >= 1 && s <= 8) ? s : 0;
}

// The ONE schedule confirmation Teddy wants (2026-07-12): tech + day + slot, "any
// questions?" and a video-catch link if they still owe their tech a video. DAY ONLY,
// never a clock time (day-of routing; the live window is a separate morning-of text
// that stays paused for now). Tech named only when FIRMLY assigned.
function customerBody({ first, appliance, apptStr, techFirst, slot, finishLink, phone }) {
  const name = (first || '').trim() || 'there';
  const techPart = techFirst ? `Your tech is ${techFirst}, coming ${apptStr}` : `It's scheduled for ${apptStr}`;
  const slotPart = slot ? `, and you're stop ${slot} of the day` : '';
  const callNum = phone || '615-280-2949';
  const lines = [
    `Hi ${name}, good news — your ${appliance} repair is scheduled.`,
    `${techPart}${slotPart}.`,
    `We run day-of routing (no set time slots) — your tech will reach out when he's on his way.`,
    // Teddy 2026-08-06: give time-constrained customers a real path to a specific time —
    // call in, ask for their tech, and our phone system connects them; the tech knows
    // exactly when he can be there and can adjust to fit their schedule.
    `Need a specific time? Call ${callNum} and ask for your tech — he knows exactly when he can get there and can work around your schedule if you're tight on time. Any questions, just reply here.`,
  ];
  if (finishLink) lines.push(`Haven't sent your tech a video yet? Tap here so he shows up ready: ${finishLink}`);
  return lines.join(' ');
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
  const windowStr = windowLabelFor(job, scheduledStartMs);

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
  // RE-ENABLED 2026-08-06 (Teddy, per Danielle: customers weren't getting told the day).
  // Killed 7/22 when it was wrong-day/stale, but the current version is safe: DAY ONLY
  // (no clock time), deduped per (job, start_ms), skips tech_claim placeholders, requires
  // a valid phone, and carries the finish-upload link (so it passes the intake SMS gate).
  // ON by default now — set APPT_CONFIRM_CUSTOMER=false to kill it again if ever needed.
  if (String(process.env.APPT_CONFIRM_CUSTOMER || '').toLowerCase() === 'false') {
    custResult = 'disabled_day_text_off';
  } else if (SKIP_CUSTOMER_SOURCES.has(source)) {
    custResult = 'skipped_source';
  } else if (!custPhone) {
    custResult = 'skipped_invalid_phone';
  } else {
    const slot = slotFromStart(scheduledStartMs);
    // Video-catch link: the no-form finish-upload page works for warranty + cash.
    // Always offered so a customer who still owes their tech a video has it right here.
    const finishLink = `https://${bareDomain()}/finish-upload.html?job_id=${jobId}`;
    // Region-aware number so "call and ask for your tech" reaches the right line.
    // LA jobs → 504-355-9111, everything else → 615-280-2949. Both ring Ann, who
    // transfers to the assigned tech during business hours.
    const st = String(job.service_state || '').trim().toUpperCase();
    const phone = (st === 'LA' || st === 'LOUISIANA') ? '504-355-9111' : '615-280-2949';
    const body = customerBody({ first: custFirst, appliance, apptStr, techFirst, slot, finishLink, phone });
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
