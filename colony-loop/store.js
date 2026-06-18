// Storage router for the colony loop.
//
// Default (no env) = Xano, exactly as before — zero behavior change.
//
// With LOOP_STORE=local, the loop's SIGNAL QUEUE (the working memory it polls +
// writes every tick — the thing a signal storm piles up and melts Xano with)
// moves to a local SQLite file (db.js). BUSINESS DATA (jobs, customers, money,
// sendSms, warranty context) and the DEDUP / AUDIT event_log stay on Xano, so
// the office pages and the loop's dedup are untouched. External producers
// (Netlify/XS) still write to Xano's colony_signals; drainInbox() pulls those
// into the local queue each tick, so nothing is lost and Xano can't melt.
//
// Exposed as one object mirroring xano.js's API so callers swap it in with a
// one-line alias (`const xano = store`).
import * as xano from './xano.js';

const LOCAL = String(process.env.LOOP_STORE || '').toLowerCase() === 'local';

let db = null;
if (LOCAL) {
  try { db = await import('./db.js'); }
  catch (e) { console.error('[store] LOOP_STORE=local but db.js failed — staying on Xano:', e.message); db = null; }
}

const usingLocal = !!(LOCAL && db);

// Start from the full Xano API; override ONLY the queue functions when local.
const store = { ...xano };

// The signal QUEUE — moves to local SQLite when LOCAL. Deliberately NOT moving
// checkEventLogFiredToday / recordEvent / recordEventLog: those write the dedup
// markers + business-audit rows the office reads, so they stay on Xano (keeps
// dedup consistent and office pages intact).
const QUEUE_FNS = ['fetchPendingSignals', 'emitSignal', 'markSignalProcessed', 'countPendingSignalsForJob'];
if (usingLocal) {
  for (const fn of QUEUE_FNS) {
    if (typeof db[fn] === 'function') store[fn] = db[fn];
  }
}

store._usingLocal = usingLocal;
store.localStats = usingLocal ? db.stats : () => ({ store: 'xano' });
store.localGc = usingLocal ? db.gc : () => ({ signals_deleted: 0, events_deleted: 0 });

export default store;
export { usingLocal };

// Pull external Xano signals into the local queue + mark the Xano row processed.
// Runs once per tick when local. No-op (and never touches Xano) when on Xano.
export async function drainInbox(limit = 100) {
  if (!usingLocal || !db) return { drained: 0, off: true };
  let rows = [];
  try { rows = await xano.fetchPendingSignals(limit); } catch (_) { return { drained: 0, error: 'xano_fetch_failed' }; }
  let drained = 0;
  for (const row of rows || []) {
    try {
      const ingested = await db.ingestInboxSignal(row);          // → local queue (idempotent on the Xano row id)
      await xano.markSignalProcessed(row.id, 'drained_to_local', { inbox: true });  // retire the Xano row
      if (ingested) drained++;
    } catch (_) {}
  }
  return { drained, scanned: (rows || []).length };
}
