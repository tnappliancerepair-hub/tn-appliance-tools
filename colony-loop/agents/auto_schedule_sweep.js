// auto_schedule_sweep — the UNIVERSAL auto-place trigger.
//
// The hole this closes: auto-place (job_intake_complete) only fired on the
// warranty resume-chat path (update_job_from_chat). Cash/Quick-Check, AHS &
// ServicePower email intake, and phone-call jobs never reached the engine, so
// "complete auto-scheduling" was impossible. This sweep pulls the office
// needs-scheduled queue (EVERY intake source) and feeds each ready job through
// the SAME engine by emitting JOB_INTAKE_COMPLETE with source:'auto_schedule_sweep'.
//
// Flood-safe + lean (no Xano melt, no SMS spam):
//   - Only runs when the autopilot is on (config.techOfferEnabled); else no-op.
//   - Caps emits per run (CAP) and pulls a bounded list (PULL).
//   - Per-job dedup: skips a job evaluated in the last ~20h.
//   - Sweep-sourced signals are SILENT in job_intake_complete (no owner SMS on
//     blocked gates / shadow); Teddy reviews via event_log. Tech still gets the
//     heads-up on a real live placement.
import { config } from '../config.js';

const PULL = 40;            // how many needs-scheduled jobs to look at per run
const CAP = 12;             // max evaluations to kick off per run (flood guard)
const DEDUP_MS = 20 * 60 * 60 * 1000; // re-evaluate a job at most ~once/day

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  // Autopilot off → do nothing (the sweep only matters when auto-place is armed).
  if (!config.techOfferEnabled) {
    const meta = { outcome: 'autopilot_off' };
    await xano.markSignalProcessed(signal.id, 'auto_schedule_sweep_handled', meta);
    log('auto_schedule_sweep_handled', meta);
    return { success: true, action: 'autopilot_off' };
  }

  let list;
  try { list = await xano.listNeedsScheduledParallel(PULL); }
  catch (err) {
    const meta = { outcome: 'list_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'auto_schedule_sweep_handled', meta);
    log('auto_schedule_sweep_handled', meta);
    return { success: false, action: 'list_failed' };
  }

  const items = (list && list.items) || [];
  let emitted = 0, skippedDedup = 0, scanned = 0;

  for (const it of items) {
    if (emitted >= CAP) break;
    const jobId = Number(it && it.id);
    if (!jobId) continue;
    scanned++;

    // Per-job dedup — don't re-kick a job we evaluated in the last ~20h.
    try {
      const seen = await xano.getEventLogByAction(`auto_sweep_done_${jobId}`);
      if (seen && seen.exists && seen.last_at && (Date.now() - Number(seen.last_at) < DEDUP_MS)) {
        skippedDedup++;
        continue;
      }
    } catch (_) { /* on lookup failure, fall through and evaluate (gates are silent) */ }

    try {
      await xano.emitSignal({
        signal_type: 'JOB_INTAKE_COMPLETE',
        signal_strength: 40,
        payload: { job_id: jobId, source: 'auto_schedule_sweep' },
      });
      await xano.recordEvent(`auto_sweep_done_${jobId}`, { job_id: jobId, at_ms: Date.now() });
      emitted++;
    } catch (err) {
      log('auto_schedule_sweep_emit_failed', { job_id: jobId, error: String(err.message || err) });
    }
  }

  const meta = { outcome: 'swept', queue_size: items.length, scanned, emitted, skipped_dedup: skippedDedup, live: !!config.techOfferLive };
  await xano.markSignalProcessed(signal.id, 'auto_schedule_sweep_handled', meta);
  log('auto_schedule_sweep_handled', meta);
  return { success: true, action: 'swept', ...meta };
}
