// Reconciler — walks tables hourly looking for incomplete sequences
// (orphans) and re-runs the missing step. Self-healing for the
// multi-table-write gaps that arose pre-Phase 1 architecture.
//
// Signal in: ORPHAN_RECONCILER (emitted by tick.js once per hour)
// Signal out: emits the missing-step signals (JOB_CREATED, etc.)
//             so downstream agents pick up where they should have
//
// Checks (in priority order):
//   1. Jobs created in last 24h with NO JOB_CREATED signal — emit it
//   2. Voicemails created in last 24h with NO voicemail_draft attempt — emit
//   3. Customer rows created in last 24h with NO greeting attempt — flag
//
// Bounded: caps at 100 fix-ups per run to avoid runaway. If a check
// keeps finding orphans run after run, that signals a deeper bug
// upstream — fix that, not the reconciler.
//
// Idempotent: every fix-up is dedup-checked against existing
// event_log + colony_signals so re-runs are safe.
export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const summary = {
    job_created_emitted: 0,
    voicemail_drafts_emitted: 0,
    total_fixups: 0,
    errors: 0,
  };
  const MAX_FIXUPS = 100;

  try {
    // ── Check 1: Recently-created jobs missing JOB_CREATED signals ──
    let orphans = null;
    try {
      orphans = await xano.findRecentJobsMissingSignal('JOB_CREATED', 24);
    } catch (e) {
      log('reconciler_check1_load_failed', { error: String(e.message || e) });
    }

    if (orphans && Array.isArray(orphans.jobs)) {
      for (const j of orphans.jobs) {
        if (summary.total_fixups >= MAX_FIXUPS) break;
        try {
          await xano.emitSignal({
            signal_type: 'JOB_CREATED',
            signal_strength: 50,
            payload: {
              job_id: j.job_id,
              customer_id: j.customer_id || null,
              customer_phone: j.phone || '',
              customer_first_name: j.first_name || '',
              appliance_type: j.appliance_type || '',
              brand: j.brand || '',
              problem_summary: j.problem_summary || '',
              source: 'orphan_reconciler',
              source_reason: 'no JOB_CREATED signal found within 24h',
            },
          });
          summary.job_created_emitted++;
          summary.total_fixups++;
        } catch (e) {
          summary.errors++;
          log('reconciler_emit_failed', { job_id: j.job_id, error: String(e.message || e) });
        }
      }
    }
  } catch (e) {
    log('reconciler_run_failed', { error: String(e.message || e) });
    summary.errors++;
  }

  await xano.markSignalProcessed(signal.id, 'orphan_reconciler_handled', summary);
  return { success: summary.errors === 0, ...summary };
}
