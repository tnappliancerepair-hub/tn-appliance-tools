// Handles GHOST_INTAKE_SWEEP signals (emitted weekly Sun 5am CT by tick).
// Auto-cancels jobs in not_ready/prediagnosis_pending for >14 days with
// no customer_preference_text (i.e. customer never engaged via resume).
//
// Caps at 20 cancels/week so we don't accidentally nuke real backlog.
import { config } from '../config.js';
import { toOwner } from '../sms.js';

const CANCEL_CAP = 20;
const STALE_DAYS = 14;

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  let candidates = [];
  try {
    const res = await fetch(`${config.xanoIntakeBase}/get_resume_chat_pending?hours_since_greeting=${STALE_DAYS * 24}&limit=50`);
    const data = await res.json();
    candidates = (data && data.jobs) || [];
  } catch (err) {
    log('ghost_intake_load_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'ghost_intake_sweep_handled', { outcome: 'load_failed' });
    return { success: false, action: 'load_failed' };
  }

  if (candidates.length === 0) {
    await xano.markSignalProcessed(signal.id, 'ghost_intake_sweep_handled', { outcome: 'no_candidates' });
    return { success: true, action: 'no_candidates' };
  }

  const toCancel = candidates.slice(0, CANCEL_CAP);
  const cancelled = [];
  const errors = [];

  for (const j of toCancel) {
    try {
      const res = await fetch(`${config.xanoIntakeBase}/cancel_job`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          job_id: j.job_id,
          reason: 'auto-canceled by ghost_intake_sweep: no customer engagement in 14d',
          source: 'ghost_intake_sweep',
        }),
      });
      const d = await res.json();
      if (d && d.success) {
        cancelled.push(j.job_id);
      } else {
        errors.push({ job_id: j.job_id, error: (d && d.error) || 'unknown' });
      }
    } catch (err) {
      errors.push({ job_id: j.job_id, error: String(err.message || err) });
    }
  }

  // SMS Teddy a summary
  if (cancelled.length > 0) {
    try {
      await toOwner(
        `[ant] 🧹 ghost-intake sweep: ${cancelled.length} stale ${cancelled.length === 1 ? 'job' : 'jobs'} auto-canceled (14d no customer engagement). IDs: ${cancelled.slice(0, 10).join(', ')}${cancelled.length > 10 ? '…' : ''}`,
        { action: 'ghost_intake_sweep_alert', count: cancelled.length, source_signal_id: signal.id }
      );
    } catch (err) { /* */ }
  }

  const meta = {
    outcome: 'swept',
    candidate_count: candidates.length,
    cancelled_count: cancelled.length,
    error_count: errors.length,
  };
  await xano.markSignalProcessed(signal.id, 'ghost_intake_sweep_handled', meta);
  log('ghost_intake_sweep_handled', meta);
  return { success: true, action: 'swept', ...meta };
}
