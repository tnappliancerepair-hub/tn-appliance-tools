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

  // Green-light path.
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
