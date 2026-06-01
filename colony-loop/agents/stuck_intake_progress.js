// Fires once daily at 10:45am CT. Sweeps not_ready parallel-mode jobs
// older than 48h with empty customer_preference_text and SMSes the
// customer "morning or afternoon?" Once they reply M or A, the inbound
// handler updates the job and advances scheduling_status.
//
// Single-nudge-per-job dedup via event_log
// stuck_intake_progress_nudged_<job_id> action.
//
// Signal in:  STUCK_INTAKE_PROGRESS_BATCH (from tick.js)
// Signal out: none — terminal
import { normalizeE164, toCustomer } from '../sms.js';

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  let payload;
  try {
    payload = await xano.listStuckIntakeForProgress({ limit: 50, min_age_hours: 48 });
  } catch (err) {
    log('stuck_intake_load_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'stuck_intake_progress_handled', {
      outcome: 'load_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'load_failed' };
  }

  const jobs = (payload && payload.jobs) || [];
  if (jobs.length === 0) {
    await xano.markSignalProcessed(signal.id, 'stuck_intake_progress_handled', {
      outcome: 'no_jobs_pending',
    });
    return { success: true, action: 'no_jobs_pending', job_count: 0 };
  }

  const results = { sent: 0, skipped_dedup: 0, skipped_no_phone: 0, errors: 0 };

  for (const j of jobs) {
    const jobId = Number(j.job_id);
    if (!jobId) continue;

    const dedupAction = `stuck_intake_progress_nudged_${jobId}`;
    try {
      const prior = await xano.getEventLogByAction(dedupAction);
      if (prior && prior.exists) {
        results.skipped_dedup++;
        continue;
      }
    } catch (_) { /* fail-open */ }

    const normPhone = normalizeE164(j.phone);
    if (!normPhone) {
      results.skipped_no_phone++;
      continue;
    }

    const firstName = String(j.first_name || '').trim() || 'there';
    const appliance = String(j.appliance_type || 'repair').trim() || 'repair';
    const body = `Hi ${firstName} - quick question about your ${appliance} repair. What time of day works best — morning or afternoon? Reply M or A and we'll book you in. -TN Appliance`;

    try {
      await toCustomer(normPhone, body, {
        context_tag: 'stuck_intake_progress',
        job_id: jobId,
      });
      // Audit dedup row
      await xano.recordEventLog(dedupAction, {
        job_id: jobId,
        customer_id: j.customer_id || null,
        phone: normPhone,
        body_preview: body.slice(0, 100),
      });
      results.sent++;
    } catch (err) {
      log('stuck_intake_sms_failed', { job_id: jobId, error: String(err.message || err) });
      results.errors++;
    }
  }

  await xano.markSignalProcessed(signal.id, 'stuck_intake_progress_handled', {
    outcome: 'batch_complete',
    ...results,
    job_count: jobs.length,
  });

  return { success: true, action: 'batch_complete', ...results, job_count: jobs.length };
}
