// Storage router for the colony loop.
//
// Default (no env) = Xano, exactly as before — zero behavior change.
//
// LOOP_STORE=local  → the SIGNAL QUEUE moves to local SQLite (db.js).
// LOOP_STORE=pg     → the SIGNAL QUEUE moves to Supabase Postgres (pg.js) — the
//                     Phase-2 shadow spine (LOCKED Decision #1).
//
// In both cases only the QUEUE functions move (the thing a signal storm piles up
// and melts Xano with). BUSINESS DATA (jobs, customers, money, sendSms, warranty
// context) and the DEDUP / AUDIT event_log stay on Xano, so the office pages and
// the loop's dedup stay consistent. External producers (Netlify/XS) still write to
// Xano's colony_signals; drainInbox() pulls those into the alternate queue each
// tick, so nothing is lost and Xano can't melt.
//
// TEE (LOOP_PG_TEE=true on the LIVE loop): mirror every emitted signal into
// Postgres, best-effort + fire-and-forget, so the pg shadow can replay the real
// stream WITHOUT draining the live queue. Never blocks or throws into the live path.
//
// Exposed as one object mirroring xano.js's API so callers swap it in with a
// one-line alias (`const xano = store`).
import * as xano from './xano.js';

const MODE = String(process.env.LOOP_STORE || '').toLowerCase();   // '' | 'local' | 'pg'
const LOCAL = MODE === 'local';
const PG = MODE === 'pg';

// The alternate queue store (db.js or pg.js), loaded only when selected.
let alt = null;
if (LOCAL) {
  try { alt = await import('./db.js'); }
  catch (e) { console.error('[store] LOOP_STORE=local but db.js failed — staying on Xano:', e.message); alt = null; }
} else if (PG) {
  try {
    const m = await import('./pg.js');
    if (m.isConfigured && m.isConfigured()) alt = m;
    else { console.error('[store] LOOP_STORE=pg but SUPABASE_URL/SERVICE_KEY missing — staying on Xano'); alt = null; }
  } catch (e) { console.error('[store] LOOP_STORE=pg but pg.js failed — staying on Xano:', e.message); alt = null; }
}

const usingLocal = !!(LOCAL && alt);
const usingPg = !!(PG && alt);
const usingAlt = usingLocal || usingPg;

// Start from the full Xano API; override ONLY the queue functions when on an alt store.
const store = { ...xano };

// The signal QUEUE — moves to the alt store. Deliberately NOT moving
// checkEventLogFiredToday / recordEvent / recordEventLog: those write the dedup
// markers + business-audit rows the office reads, so they stay on Xano (keeps
// dedup consistent and office pages intact).
const QUEUE_FNS = ['fetchPendingSignals', 'emitSignal', 'markSignalProcessed', 'countPendingSignalsForJob'];
if (usingAlt) {
  for (const fn of QUEUE_FNS) {
    if (typeof alt[fn] === 'function') store[fn] = alt[fn];
  }
}

// ── TEE (Phase-2 shadow prep) ────────────────────────────────────────────────
// On the LIVE loop (not the pg shadow itself), LOOP_PG_TEE=true mirrors every
// emitted signal into Postgres so the shadow can replay the live stream without
// draining the live queue. Detached (never awaited in the live path) + swallowed.
let teeing = false;
const TEE_ON = !PG && ['1', 'true', 'yes'].includes(String(process.env.LOOP_PG_TEE || '').toLowerCase());
if (TEE_ON) {
  try {
    const pg = await import('./pg.js');
    if (pg.isConfigured && pg.isConfigured()) {
      const liveEmit = store.emitSignal;
      store.emitSignal = async (sig) => {
        const res = await liveEmit(sig);                                    // real live emit — unchanged
        Promise.resolve().then(() => pg.emitSignal({ ...sig, _origin: 'tee' })).catch(() => {}); // mirror, detached
        return res;
      };
      teeing = true;
    } else {
      console.error('[store] LOOP_PG_TEE on but SUPABASE creds missing — tee off');
    }
  } catch (e) { console.error('[store] LOOP_PG_TEE on but pg.js failed — tee off:', e.message); }
}

store._usingLocal = usingLocal;
store._usingPg = usingPg;
store._teeing = teeing;
store._storeMode = usingPg ? 'pg' : (usingLocal ? 'local' : 'xano');
store.localStats = usingAlt ? alt.stats : () => ({ store: 'xano' });
store.localGc = usingAlt ? alt.gc : () => ({ signals_deleted: 0, events_deleted: 0 });

export default store;
export { usingLocal, usingPg };

// Pull external Xano signals into the alt queue (local or pg) + mark the Xano row
// processed. Runs once per tick when on an alt store. No-op (never touches Xano)
// when on plain Xano.
export async function drainInbox(limit = 100) {
  if (!usingAlt || !alt) return { drained: 0, off: true };
  let rows = [];
  try { rows = await xano.fetchPendingSignals(limit); } catch (_) { return { drained: 0, error: 'xano_fetch_failed' }; }
  let drained = 0;
  for (const row of rows || []) {
    try {
      const ingested = await alt.ingestInboxSignal(row);        // → alt queue (idempotent on the Xano row id)
      await xano.markSignalProcessed(row.id, 'drained_to_local', { inbox: true });  // retire the Xano row
      if (ingested) drained++;
    } catch (_) {}
  }
  return { drained, scanned: (rows || []).length };
}
