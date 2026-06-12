// Nightly event_log garbage collection. Calls cleanup_event_log in noise_only
// mode in several capped passes, draining the high-volume, non-dedup plumbing
// rows (signal_processed / no_agent_yet / colony_signal_emitted / loop ticks)
// older than 7 days. Never touches dedup/audit rows, so no re-fire risk.
//
// Per-row delete is ~11ms, so each pass is capped at 2500 (~28s) and we run up
// to 8 passes (stop early once a pass clears the backlog). This bounds storage
// growth on the 10GB Essential cap. NOTE: the durable fix is reducing how many
// plumbing rows the colony loop writes in the first place (tick.js) — this GC
// keeps it in check until then.

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const PASS_CAP = 2500;
const MAX_PASSES = 8;

async function gcPass() {
  const r = await fetch(XANO + '/cleanup_event_log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ noise_only: true, dry_run: false, older_than_days: 7, max_delete: PASS_CAP }),
  });
  const d = await r.json().catch(() => ({}));
  return Number(d.deleted_count || 0);
}

exports.handler = async () => {
  const startedAt = Date.now();
  let total = 0;
  let passes = 0;
  for (let i = 0; i < MAX_PASSES; i++) {
    let deleted = 0;
    try { deleted = await gcPass(); } catch (e) { break; }
    total += deleted;
    passes += 1;
    if (deleted < PASS_CAP) break; // backlog drained for tonight
  }
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, deleted: total, passes, elapsed_ms: Date.now() - startedAt }),
  };
};
