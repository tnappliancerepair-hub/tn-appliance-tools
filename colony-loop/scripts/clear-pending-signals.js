// One-off incident cleanup: clear a backlog of PENDING colony_signals of a given
// type WITHOUT running their agents — so a stale hold-and-re-emit backlog (built
// up while the loop was down) does NOT fire a flood of SMS when the loop restarts.
// Each matching signal is marked processed with outcome 'cleared_stale_backlog'.
//
// Usage (run with the colony loop STOPPED so it isn't racing you):
//   launchctl bootout gui/$UID/com.tnappliance.colony-loop
//   cd ~/tn-appliance-tools/colony-loop
//   node scripts/clear-pending-signals.js PRE_APPOINTMENT_CHECK
//
// Pass any signal_type as the first arg. Default is PRE_APPOINTMENT_CHECK.
import * as xano from '../xano.js';

const TYPE = (process.argv[2] || 'PRE_APPOINTMENT_CHECK').toUpperCase();
const BATCH = 200;
const CONCURRENCY = 10;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  console.log(`Clearing pending ${TYPE} signals (loop should be stopped)…`);
  let cleared = 0;
  for (let iter = 0; iter < 5000; iter++) {
    const items = await xano.fetchPendingSignals(BATCH);
    if (!items.length) break;
    const targets = items.filter((s) => String(s.signal_type).toUpperCase() === TYPE);
    if (!targets.length) break; // no more of this type visible in the pending window
    for (const group of chunk(targets, CONCURRENCY)) {
      await Promise.all(
        group.map((s) =>
          xano.markSignalProcessed(s.id, 'cleared_stale_backlog', {
            outcome: 'incident_cleanup', signal_type: TYPE,
          }).catch((e) => console.error('  mark failed', s.id, String(e.message || e)))
        )
      );
      cleared += group.length;
    }
    console.log(`… ${cleared} cleared`);
  }
  console.log(`DONE — cleared ${cleared} pending ${TYPE} signals.`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
