// Self-test for the local SQLite store (db.js). Uses a throwaway DB so it never
// touches the real loop.db. Run on the Mac after `npm install`:
//   cd ~/tn-appliance-tools/colony-loop && npm install && npm run db:test
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';

const TEST_DB = join(tmpdir(), 'loop-store-test-' + Date.now() + '.db');
process.env.LOOP_DB_PATH = TEST_DB;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}

const db = await import('../db.js');

try {
  console.log('Local store self-test (' + TEST_DB + ')\n');

  // emit + fetch
  await db.emitSignal({ signal_type: 'TEST_A', payload: { job_id: 101 } });
  await db.emitSignal({ signal_type: 'TEST_A', payload: { job_id: 101 } });
  await db.emitSignal({ signal_type: 'TEST_B', payload: { job_id: 202 } });
  const pending = await db.fetchPendingSignals(50);
  check('3 signals pending after emit', pending.length === 3);
  check('payload is a JSON string (matches Xano shape)', typeof pending[0].payload === 'string');
  check('created_at is a number (TTL math works)', typeof pending[0].created_at === 'number');
  check('trace_id auto-added', JSON.parse(pending[0].payload).trace_id != null);

  // count per job
  const cA = await db.countPendingSignalsForJob('TEST_A', 101);
  check('countPendingSignalsForJob TEST_A/101 == 2', cA.pending_count === 2);
  const cB = await db.countPendingSignalsForJob('TEST_B', 202);
  check('countPendingSignalsForJob TEST_B/202 == 1', cB.pending_count === 1);

  // mark processed
  await db.markSignalProcessed(pending[0].id, 'handled_ok', { foo: 'bar' });
  const pending2 = await db.fetchPendingSignals(50);
  check('1 fewer pending after mark', pending2.length === 2);

  // dedup
  const before = await db.checkEventLogFiredToday('daily_thing_emitted', '2026-06-16');
  check('dedup false before marking', before === false);
  db.markFiredThisProcess('daily_thing_emitted', '2026-06-16');
  const after = await db.checkEventLogFiredToday('daily_thing_emitted', '2026-06-16');
  check('dedup true after markFiredThisProcess', after === true);

  // recordEvent with {day} also marks fired (record-fail dupe guard)
  await db.recordEvent('other_thing_emitted', { day: '2026-06-16', detail: 'x' });
  const after2 = await db.checkEventLogFiredToday('other_thing_emitted', '2026-06-16');
  check('recordEvent({day}) marks fired', after2 === true);

  // event log persisted
  await db.recordEventLog('something_happened', { n: 1 });
  const st = db.stats();
  check('event_log has rows', st.event_log_rows > 0);
  check('stats reports pending count', st.pending_signals === 2);

  // gc (nothing old enough to delete → 0)
  const g = db.gc();
  check('gc runs cleanly', typeof g.signals_deleted === 'number');

  console.log('\n' + (fail === 0 ? '✅ ALL PASS' : '❌ ' + fail + ' FAILED') + '  (' + pass + ' passed)');
} finally {
  try { unlinkSync(TEST_DB); } catch (_) {}
  try { unlinkSync(TEST_DB + '-wal'); } catch (_) {}
  try { unlinkSync(TEST_DB + '-shm'); } catch (_) {}
}

process.exit(fail === 0 ? 0 : 1);
