// Handles JOB_INTAKE_COMPLETE signals (emitted by update_job_from_chat when
// a warranty customer finishes resume-mode chat). Decides whether the job
// is ready to schedule, surfaces a status-specific SMS to Teddy on each
// blocked-path, and on green-light enqueues a scheduling_queue 'propose'
// row that triggers the existing worker to SMS Teddy 3 slot options.
//
// Gate ladder (each branch terminates with markSignalProcessed + a Teddy SMS):
//   1. scheduling_status ∈ ALREADY_SCHEDULED_STATUSES  → silent skip
//   2. warranty_company in {SquareTrade, ServicePower} AND scheduled_start set
//      → silent skip (date locked by vendor)
//   3. !has_pre_diagnosis
//      → SMS "needs your pre-diagnosis in Teddy Tool"
//   4. parts_status ∈ PARTS_PENDING_STATUSES
//      → SMS "ready except waiting on parts" + emit WAITING_FOR_PARTS
//   5. pending propose row already on queue for this job → silent skip
//   6. green-light → enqueue propose w/ priority=1 + SMS Teddy w/ city
import { toOwner } from '../sms.js';
import { config } from '../config.js';

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

const PARTS_PENDING_STATUSES = new Set([
  'parts_needed',
  'ordered',
  'pending',
  'on_order',
]);

const ALREADY_SCHEDULED_STATUSES = new Set([
  'scheduled',
  'in_progress',
  'completed',
  'canceled',
  'no_fix_possible',
  'booked',
]);

// Warranty companies that get their appointment date set upstream — used
// as a fallback when the new jobs.vendor_locked boolean isn't set on an
// older job row. New writes (ServicePower DISPATCH_OFFER / SCHEDULE_CHANGE)
// set vendor_locked=true directly, which is the canonical signal.
const VENDOR_LOCKED_WARRANTIES = new Set([
  'squaretrade',
  'st',
  'servicepower',
  'sp',
]);

function applianceLabel(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return APPLIANCE_NICE[s] || s || 'appliance';
}

function customerLabel(customer) {
  const first = (customer?.first_name || '').trim();
  const last = (customer?.last_name || '').trim();
  const full = [first, last].filter(Boolean).join(' ');
  return full || '(no name)';
}

function cityLabel(customer, jobAddress) {
  // Prefer job.service_city when set; fall back to customer.city.
  const svc = (jobAddress?.service_city || '').trim();
  if (svc) return svc;
  const cust = (customer?.city || '').trim();
  return cust || '(no city)';
}

function isVendorLocked(warranty_company) {
  const s = String(warranty_company || '').toLowerCase().replace(/[\s_-]/g, '');
  return VENDOR_LOCKED_WARRANTIES.has(s);
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  if (!jobId) throw new Error('payload.job_id required');

  let ctxData;
  try {
    ctxData = await xano.getAutoScheduleContext(jobId);
  } catch (err) {
    const meta = { job_id: jobId, outcome: 'context_load_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
    log('try_auto_schedule_handled', meta);
    return { success: false, action: 'context_load_failed', job_id: jobId };
  }

  if (!ctxData || !ctxData.success) {
    const meta = { job_id: jobId, outcome: 'context_missing' };
    await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
    log('try_auto_schedule_handled', meta);
    return { success: false, action: 'context_missing', job_id: jobId };
  }

  const { job, customer, job_address, has_pre_diagnosis, pending_propose_count } = ctxData;
  const appliance = applianceLabel(job.appliance_type);
  const custName = customerLabel(customer);
  const city = cityLabel(customer, job_address);

  // Gate 1: already past the "needs a time" stage.
  const schedStatus = String(job.scheduling_status || '').trim().toLowerCase();
  if (ALREADY_SCHEDULED_STATUSES.has(schedStatus)) {
    const meta = { job_id: jobId, outcome: 'already_scheduled', scheduling_status: schedStatus };
    await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
    log('try_auto_schedule_handled', meta);
    return { success: true, action: 'already_scheduled', job_id: jobId };
  }

  // Gate 2: vendor-locked appointment (date pre-set by SquareTrade /
  // ServicePower dispatch). Two ways to detect:
  //   (a) vendor_locked column is true on the job (canonical, set by the
  //       producer endpoint at write time)
  //   (b) warranty_company matches a known vendor AND scheduled_start is
  //       set (legacy / backstop for older rows written before the column
  //       existed).
  // Either path: skip without re-proposing.
  const explicitVendorLocked = job.vendor_locked === true;
  const legacyVendorLocked =
    isVendorLocked(job.warranty_company) && job.scheduled_start != null;
  if (explicitVendorLocked || legacyVendorLocked) {
    const meta = {
      job_id: jobId,
      outcome: 'skipped_vendor_locked_date',
      warranty_company: job.warranty_company || '',
      scheduling_type: job.scheduling_type || '',
      vendor_locked: job.vendor_locked === true,
      detected_via: explicitVendorLocked ? 'vendor_locked_flag' : 'legacy_warranty_name',
      scheduled_start: job.scheduled_start,
    };
    await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
    log('try_auto_schedule_handled', meta);
    return { success: true, action: 'skipped_vendor_locked_date', job_id: jobId };
  }

  // Gate 3: pre-diagnosis missing.
  if (!has_pre_diagnosis) {
    const body =
      `[ant] Job #${jobId} customer intake complete - needs your pre-diagnosis in Teddy Tool.\n` +
      `${custName}, ${appliance}, ${city}`;
    let smsRes;
    try {
      smsRes = await toOwner(body, {
        action: 'try_auto_schedule_prediag_needed',
        job_id: jobId,
        source_signal_id: signal.id,
      });
    } catch (err) {
      smsRes = { success: false, error: String(err.message || err) };
    }
    const meta = {
      job_id: jobId,
      outcome: 'awaiting_prediagnosis',
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    };
    await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
    log('try_auto_schedule_handled', meta);
    return { success: true, action: 'awaiting_prediagnosis', job_id: jobId };
  }

  // Gate 4: parts blocked.
  const partsStatus = String(job.parts_status || '').trim().toLowerCase();
  if (PARTS_PENDING_STATUSES.has(partsStatus)) {
    const body =
      `[ant] Job #${jobId} ready except waiting on parts (status=${partsStatus}).\n` +
      `${custName}, ${appliance}, ${city}`;
    let smsRes;
    try {
      smsRes = await toOwner(body, {
        action: 'try_auto_schedule_waiting_parts',
        job_id: jobId,
        parts_status: partsStatus,
        source_signal_id: signal.id,
      });
    } catch (err) {
      smsRes = { success: false, error: String(err.message || err) };
    }

    // Emit WAITING_FOR_PARTS so a future parts-arrival agent can retry.
    let wfpSignalId = null;
    try {
      const emit = await xano.emitSignal({
        signal_type: 'WAITING_FOR_PARTS',
        signal_strength: 50,
        payload: {
          job_id: jobId,
          customer_id: customer?.id || null,
          parts_status: partsStatus,
          warranty_company: job.warranty_company || '',
          appliance_type: job.appliance_type || '',
          source: 'try_auto_schedule',
          source_signal_id: signal.id,
        },
      });
      wfpSignalId = emit && (emit.signal_id || emit.id);
    } catch (err) {
      log('try_auto_schedule_wfp_emit_failed', { job_id: jobId, error: String(err.message || err) });
    }

    const meta = {
      job_id: jobId,
      outcome: 'awaiting_parts',
      parts_status: partsStatus,
      waiting_for_parts_signal_id: wfpSignalId,
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    };
    await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
    log('try_auto_schedule_handled', meta);
    return { success: true, action: 'awaiting_parts', job_id: jobId };
  }

  // Gate 5: already enqueued.
  if (Number(pending_propose_count) > 0) {
    const meta = { job_id: jobId, outcome: 'already_enqueued' };
    await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
    log('try_auto_schedule_handled', meta);
    return { success: true, action: 'already_enqueued', job_id: jobId };
  }

  // Green-light path. Two modes:
  //   AUTO_BOOK_ENABLED=true  → attempt true auto-book (zip → tech +
  //                            earliest open slot at/after parts_eta).
  //                            On any failure, fall through to propose.
  //   default                 → enqueue propose (Teddy picks from 3).

  if (config.autoBookEnabled) {
    const autoBookResult = await tryAutoBook({ jobId, job, customer, job_address, ctx });
    if (autoBookResult.success) {
      const meta = {
        job_id: jobId,
        outcome: 'auto_booked',
        technician_id: autoBookResult.technician_id,
        scheduled_start_ms: autoBookResult.scheduled_start_ms,
        appointment_signal_id: autoBookResult.appointment_signal_id,
        warranty_company: job.warranty_company || '',
        city,
      };
      await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
      log('try_auto_schedule_handled', meta);

      const ymd = new Date(autoBookResult.scheduled_start_ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
      const tmStr = new Date(autoBookResult.scheduled_start_ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
      const body = `[ant] Job #${jobId} auto-booked: tech ${autoBookResult.technician_id}, ${ymd} ${tmStr} CT - ${custName}, ${appliance}, ${city}`;
      await toOwner(body, {
        action: 'try_auto_schedule_auto_booked',
        job_id: jobId,
        technician_id: autoBookResult.technician_id,
        scheduled_start_ms: autoBookResult.scheduled_start_ms,
        source_signal_id: signal.id,
      });

      return { success: true, action: 'auto_booked', job_id: jobId, ...autoBookResult };
    }

    log('try_auto_schedule_autobook_falling_back', {
      job_id: jobId,
      reason: autoBookResult.reason,
      detail: autoBookResult.detail,
    });
    // fall through to the legacy propose path below
  }

  let enqueueRes;
  try {
    enqueueRes = await xano.enqueueSchedulingQueuePropose(jobId, 'try_auto_schedule', 1);
  } catch (err) {
    const meta = { job_id: jobId, outcome: 'enqueue_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
    log('try_auto_schedule_handled', meta);
    return { success: false, action: 'enqueue_failed', job_id: jobId };
  }

  const body = `[ant] Job #${jobId} ready to schedule - ${custName}, ${appliance}, ${city}. Sending you 3 options now.`;
  const smsRes = await toOwner(body, {
    action: 'try_auto_schedule_owner_heads_up',
    job_id: jobId,
    scheduling_queue_id: enqueueRes && enqueueRes.scheduling_queue_id,
    source_signal_id: signal.id,
  });

  const meta = {
    job_id: jobId,
    outcome: 'enqueued',
    scheduling_queue_id: enqueueRes && enqueueRes.scheduling_queue_id,
    warranty_company: job.warranty_company || '',
    parts_status: partsStatus,
    city,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
  log('try_auto_schedule_handled', meta);

  return {
    success: true,
    action: 'enqueued',
    job_id: jobId,
    scheduling_queue_id: enqueueRes && enqueueRes.scheduling_queue_id,
  };
}

// System cap on jobs per tech per day. Phase 2 will replace this with
// per-tech technicians.max_jobs_per_day. Until then, 6 is the rule.
const SYSTEM_MAX_JOBS_PER_DAY = 6;

// Job duration default. Used to validate slot fits within working
// window and to set scheduled_end_ms.
const DEFAULT_JOB_DURATION_MS = 2 * 60 * 60 * 1000;

// Earliest slot offset from working_start. Gives the tech a small
// runway after starting their day instead of front-loading at 8 AM
// every time. Phase 3 (resequencer) will replace this with route-aware
// slot picking.
const SLOT_OFFSET_FROM_START_MS = 60 * 60 * 1000;

// Try to deterministically auto-book the job. Returns
//   {success: true, technician_id, scheduled_start_ms, appointment_signal_id}
//   or {success: false, reason, detail?}
async function tryAutoBook({ jobId, job, customer, job_address, ctx }) {
  const { xano, log } = ctx;

  const zip = (job_address?.service_zip || customer?.zip || '').trim();
  if (!zip) return { success: false, reason: 'no_zip' };

  // Resolve tech by zip.
  let routing;
  try {
    routing = await xano.getTechForZip(zip, true);
  } catch (err) {
    return { success: false, reason: 'tech_routing_failed', detail: String(err.message || err) };
  }
  const result = routing?.response?.result || routing?.result || routing;
  if (!result || result.status !== 'assigned' || !result.technician_id) {
    return { success: false, reason: 'no_tech_for_zip', detail: result?.status || 'unknown' };
  }
  const techId = Number(result.technician_id);
  if (techId === 1) {
    // Teddy = owner / fallback router. Don't auto-assign him as the
    // working tech; fall through to manual propose so he can route.
    return { success: false, reason: 'fallback_to_owner' };
  }

  // Determine base date — parts_eta_date+1 if known, else tomorrow.
  const partsEtaDate = job.parts_eta_date ? new Date(job.parts_eta_date) : null;
  const baseDate = partsEtaDate && !isNaN(partsEtaDate) && partsEtaDate.getTime() > Date.now()
    ? new Date(partsEtaDate.getTime() + 24 * 3600 * 1000)
    : new Date(Date.now() + 24 * 3600 * 1000);

  // Walk forward up to 14 days looking for the first date that passes
  // all hard constraints. Default-Off weekends are honored implicitly:
  // tech_availability bootstrap seeds rows only for working days, so
  // Sat/Sun queries return empty → falls back to tech.preferred_hours
  // which is also weekday-shaped. Phase 2 makes this explicit via
  // per-tech day-of-week opt-in.
  const skipped = [];
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const candidate = new Date(baseDate.getTime() + dayOffset * 24 * 3600 * 1000);
    const ymd = candidate.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const dayStartMs = chicagoMidnightMs(ymd);
    const dayEndMs = dayStartMs + 24 * 3600 * 1000;

    // Weekend default OFF — agreed rule (CLAUDE.md). Tech opts into
    // Saturdays / Sundays explicitly via Phase 2 tech-preferences page.
    // Until that opt-in mechanism is wired, auto-book never lands on
    // Sat/Sun regardless of what tech_availability says.
    const dowName = candidate.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short' });
    if (dowName === 'Sat' || dowName === 'Sun') {
      skipped.push({ ymd, why: 'weekend_default_off', dow: dowName });
      continue;
    }

    let constraints;
    try {
      constraints = await xano.getTechConstraintsForDate({
        technician_id: techId,
        date_ymd: ymd,
        day_start_ms: dayStartMs,
        day_end_ms: dayEndMs,
      });
    } catch (err) {
      skipped.push({ ymd, why: 'constraints_call_failed', detail: String(err.message || err) });
      continue;
    }

    if (!constraints || !constraints.success) {
      skipped.push({ ymd, why: 'constraints_returned_failure' });
      continue;
    }

    // Hard rule: explicit day-off
    if (constraints.full_day_off) {
      skipped.push({ ymd, why: 'day_off', reason: constraints.day_off_reason });
      continue;
    }

    // Hard rule: capacity ceiling
    if (constraints.existing_job_count >= SYSTEM_MAX_JOBS_PER_DAY) {
      skipped.push({ ymd, why: 'at_capacity', count: constraints.existing_job_count });
      continue;
    }

    // Compute slot from working window
    const wStart = parseHHMM(constraints.working_start || '08:00');
    const wEnd = parseHHMM(constraints.working_end || '16:00');
    if (wStart == null || wEnd == null) {
      skipped.push({ ymd, why: 'working_window_unparseable',
        start: constraints.working_start, end: constraints.working_end });
      continue;
    }

    // Slot start = working_start + 1 hour offset (tech runway).
    // Cap so the job ends before working_end.
    let slotOffsetMin = wStart + (SLOT_OFFSET_FROM_START_MS / 60000);
    const jobDurationMin = DEFAULT_JOB_DURATION_MS / 60000;
    const latestSlotStartMin = wEnd - jobDurationMin;
    if (slotOffsetMin > latestSlotStartMin) {
      // Window too narrow to fit a 2hr job comfortably — try earlier
      slotOffsetMin = Math.max(wStart, latestSlotStartMin);
    }
    if (slotOffsetMin + jobDurationMin > wEnd) {
      skipped.push({ ymd, why: 'window_too_narrow',
        start: constraints.working_start, end: constraints.working_end });
      continue;
    }

    const startMs = dayStartMs + slotOffsetMin * 60 * 1000;

    let bookRes;
    try {
      bookRes = await xano.autoBookExistingJob({
        job_id: jobId,
        technician_id: techId,
        scheduled_start_ms: startMs,
        scheduled_end_ms: startMs + DEFAULT_JOB_DURATION_MS,
        source: 'auto_scheduler',
      });
    } catch (err) {
      return { success: false, reason: 'book_call_failed', detail: String(err.message || err), skipped_dates: skipped };
    }

    if (!bookRes || bookRes.success !== true) {
      return { success: false, reason: 'book_returned_failure',
        detail: JSON.stringify(bookRes).slice(0, 200), skipped_dates: skipped };
    }

    log('try_auto_schedule_date_search', {
      job_id: jobId,
      technician_id: techId,
      chosen_date: ymd,
      slot_minutes_from_midnight: slotOffsetMin,
      window_source: constraints.window_source,
      skipped_count: skipped.length,
    });

    return {
      success: true,
      technician_id: techId,
      scheduled_start_ms: startMs,
      appointment_signal_id: bookRes.appointment_signal_id,
      window_source: constraints.window_source,
      skipped_dates_count: skipped.length,
    };
  }

  return { success: false, reason: 'no_open_day_in_14d', skipped_dates: skipped };
}

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

// DST-correct conversion from a YMD string ("2026-05-28") to the unix
// ms at midnight America/Chicago on that date. Works in both CDT
// (UTC-5) and CST (UTC-6) because we discover the offset via Intl.
function chicagoMidnightMs(ymd) {
  const [y, mo, d] = ymd.split('-').map(Number);
  // Probe at 6am UTC of YMD — guaranteed to fall on YMD in Chicago
  // (Chicago is either 1am CDT or 12am CST at that moment).
  const probeMs = Date.UTC(y, mo - 1, d, 6, 0, 0);
  const hourFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric', hourCycle: 'h23',
  });
  const chicagoHour = parseInt(hourFmt.format(new Date(probeMs)), 10);
  // Subtract however many hours past midnight we are in Chicago time
  return probeMs - chicagoHour * 60 * 60 * 1000;
}
