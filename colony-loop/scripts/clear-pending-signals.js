// Incident tool for a stale colony_signals backlog (built up while the loop was
// down). On restart the loop drains the backlog and hold-and-re-emit agents fire
// a flood of stale SMS / Vapi calls. This script lets you SEE the backlog and
// CLEAR specific signal types WITHOUT running their agents (each matching signal
// is marked processed with outcome 'cleared_stale_backlog').
//
// Run with the colony loop STOPPED so it isn't racing you:
//   launchctl bootout gui/$UID/com.tnappliance.colony-loop
//   cd ~/tn-appliance-tools/colony-loop
//
//   node scripts/clear-pending-signals.js --report          # show pending counts by type
//   node scripts/clear-pending-signals.js PRE_APPOINTMENT_CHECK
//   node scripts/clear-pending-signals.js TYPE_A TYPE_B ...  # clear several types at once
import * as xano from '../xano.js';

const args = process.argv.slice(2);
const REPORT = args.includes('--report');
const TYPES = new Set(args.filter((a) => !a.startsWith('--')).map((a) => a.toUpperCase()));
const BATCH = 500;
const CONCURRENCY = 10;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function report() {
  // Loop is stopped, so the pending set is static — pull a big window and tally.
  const items = await xano.fetchPendingSignals(5000);
  const counts = {};
  for (const s of items) {
    const t = String(s.signal_type || '?').toUpperCase();
    counts[t] = (counts[t] || 0) + 1;
  }
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  console.log(`\nPENDING colony_signals (window of ${items.length}):`);
  for (const [t, n] of rows) console.log(`  ${String(n).padStart(6)}  ${t}`);
  console.log(`\n(If the window is exactly 5000, there may be more beyond it.)\n`);
}

async function clear() {
  console.log(`Clearing pending signals of type(s): ${[...TYPES].join(', ')}`);
  let cleared = 0;
  for (let iter = 0; iter < 5000; iter++) {
    const items = await xano.fetchPendingSignals(BATCH);
    if (!items.length) break;
    const targets = items.filter((s) => TYPES.has(String(s.signal_type).toUpperCase()));
    if (!targets.length) break; // none of the target types visible in the pending window
    for (const group of chunk(targets, CONCURRENCY)) {
      await Promise.all(
        group.map((s) =>
          xano.markSignalProcessed(s.id, 'cleared_stale_backlog', {
            outcome: 'incident_cleanup', signal_type: String(s.signal_type).toUpperCase(),
          }).catch((e) => console.error('  mark failed', s.id, String(e.message || e)))
        )
      );
      cleared += group.length;
    }
    console.log(`… ${cleared} cleared`);
  }
  console.log(`DONE — cleared ${cleared} pending signals.`);
}

async function main() {
  if (REPORT || TYPES.size === 0) { await report(); return; }
  await clear();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
