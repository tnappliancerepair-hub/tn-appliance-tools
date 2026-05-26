// Handles JOB_INTAKE_COMPLETE signals (emitted by update_job_from_chat when
// a warranty customer finishes the resume-mode form with availability +
// access notes). Decides whether the job is ready to schedule and, if so,
// enqueues a scheduling_queue 'propose' row that triggers the existing
// scheduling_queue_worker to SMS Teddy three top-scored time options.
//
// Gates (any failure short-circuits with a markSignalProcessed outcome):
//   - SquareTrade jobs: skip (ServicePower pre-sets the date)
//   - No pre-diagnosis TDR (technician_id=1) yet: skip
//   - parts_status indicates parts pending: skip
//   - already a pending propose row for this job: skip
//
// On green-light: enqueue propose, SMS Teddy a heads-up. The worker handles
// the actual three-options SMS on its next cycle.
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

// scheduling_status values that mean the job is already past the
// "needs a time" stage. Re-triggering propose would just waste the worker's
// SMS budget on a job that already has a tech + slot (or is closed).
const ALREADY_SCHEDULED_STATUSES = new Set([
  'scheduled',
  'in_progress',
  'completed',
  'canceled',
  'no_fix_possible',
  'booked',
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

function isSquareTrade(warranty_company) {
  const s = String(warranty_company || '').toLowerCase().replace(/[\s_-]/g, '');
  return s === 'squaretrade' || s === 'st';
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

  const { job, customer, has_pre_diagnosis, pending_propose_count } = ctxData;

  const schedStatus = String(job.scheduling_status || '').trim().toLowerCase();
  if (ALREADY_SCHEDULED_STATUSES.has(schedStatus)) {
    const meta = { job_id: jobId, outcome: 'already_scheduled', scheduling_status: schedStatus };
    await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
    log('try_auto_schedule_handled', meta);
    return { success: true, action: 'already_scheduled', job_id: jobId };
  }

  if (isSquareTrade(job.warranty_company)) {
    const meta = {
      job_id: jobId,
      outcome: 'skipped_squaretrade_preset',
      warranty_company: job.warranty_company || '',
    };
    await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
    log('try_auto_schedule_handled', meta);
    return { success: true, action: 'skipped_squaretrade_preset', job_id: jobId };
  }

  if (!has_pre_diagnosis) {
    const meta = { job_id: jobId, outcome: 'awaiting_prediagnosis' };
    await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
    log('try_auto_schedule_handled', meta);
    return { success: true, action: 'awaiting_prediagnosis', job_id: jobId };
  }

  const partsStatus = String(job.parts_status || '').trim().toLowerCase();
  if (PARTS_PENDING_STATUSES.has(partsStatus)) {
    const meta = { job_id: jobId, outcome: 'awaiting_parts', parts_status: partsStatus };
    await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
    log('try_auto_schedule_handled', meta);
    return { success: true, action: 'awaiting_parts', job_id: jobId };
  }

  if (Number(pending_propose_count) > 0) {
    const meta = { job_id: jobId, outcome: 'already_enqueued' };
    await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
    log('try_auto_schedule_handled', meta);
    return { success: true, action: 'already_enqueued', job_id: jobId };
  }

  let enqueueRes;
  try {
    enqueueRes = await xano.enqueueSchedulingQueuePropose(jobId, 'try_auto_schedule');
  } catch (err) {
    const meta = { job_id: jobId, outcome: 'enqueue_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'try_auto_schedule_handled', meta);
    log('try_auto_schedule_handled', meta);
    return { success: false, action: 'enqueue_failed', job_id: jobId };
  }

  const appliance = applianceLabel(job.appliance_type);
  const custName = customerLabel(customer);
  const body = `[ant] Job #${jobId} ready to schedule - ${custName}, ${appliance}. Sending you options now.`;

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
