// Handles JOB_STARTED signals (emitted by api/intake/tech_job_started_POST.xs
// when the tech taps Start Job on tech-ant-live).
//
// Side effect: emits NO_SHOW_CHECK with deadline_ms = now + 4h, so the
// no-show detector can verify the tech actually completed (or made
// observable progress) within that window. If 4h passes without a
// JOB_COMPLETED, the no_show_check.js agent SMSes Teddy.
//
// This agent doesn't send any SMS itself — JOB_STARTED already triggers
// customer arrival SMS in tech_job_started_POST.xs and Teddy gets the
// internal alert there too. This file's only job is the 4h timer.
const NO_SHOW_WINDOW_MS = 4 * 60 * 60 * 1000;

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'job_started_handled', {
      outcome: 'skipped_missing_job_id',
    });
    return { success: false, action: 'skipped_missing_job_id' };
  }

  const startedAtMs = Number(payload.started_at_ms || payload.job_started_at || Date.now());
  const deadlineMs = startedAtMs + NO_SHOW_WINDOW_MS;
  try {
    await xano.emitSignal({
      signal_type: 'NO_SHOW_CHECK',
      signal_strength: 55,
      payload: {
        job_id: jobId,
        technician_id: payload.technician_id || null,
        started_at_ms: startedAtMs,
        deadline_ms: deadlineMs,
        scheduled_for_ms: deadlineMs,
        source: 'job_started_chain',
        source_signal_id: signal.id,
      },
    });
  } catch (err) {
    log('no_show_check_emit_failed', { job_id: jobId, error: String(err.message || err) });
  }

  const meta = { job_id: jobId, outcome: 'no_show_timer_armed', deadline_ms: deadlineMs };
  await xano.markSignalProcessed(signal.id, 'job_started_handled', meta);
  log('job_started_handled', meta);
  return { success: true, action: 'no_show_timer_armed', job_id: jobId };
}
