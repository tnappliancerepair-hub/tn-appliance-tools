// Incident tool for a stale colony_signals backlog (built up while the loop was
// down). On restart the loop drains the backlog and hold-and-re-emit agents fire
// a flood of stale SMS / Vapi calls. This script lets you SEE the backlog and
// CLEAR signals WITHOUT running their agents (each marked processed with outcome
// 'cleared_stale_backlog').
//
// GENTLE on Xano: lean single-write per signal (no sibling event_log row), low
// concurrency, a pause between batches, and backoff+retry on 503/5xx. A prior
// version at concurrency 10 with double-writes triggered Xano 503s.
//
// Run with the colony loop STOPPED so it isn't racing you:
//   launchctl bootout gui/$UID/com.tnappliance.colony-loop
//   cd ~/tn-appliance-tools/colony-loop
//
//   node scripts/clear-pending-signals.js --report          # show pending counts by type
//   node scripts/clear-pending-signals.js --all             # clear the whole backlog
//   node scripts/clear-pending-signals.js TYPE_A TYPE_B ... # clear only these types
import * as xano from '../xano.js';
import { config } from '../config.js';

const args = process.argv.slice(2);
const REPORT = args.includes('--report');
const ALL = args.includes('--all'); // clear the ENTIRE pending backlog, no filter
const olderArg = args.find((a) => a.startsWith('--older-than-min='));
const OLDER_MIN = olderArg ? Number(olderArg.split('=')[1]) : 0; // 0 = disabled
const TYPES = new Set(args.filter((a) => !a.startsWith('--')).map((a) => a.toUpperCase()));

const CONCURRENCY = 3;       // gentle — was 10, which 503'd Xano
const BATCH_DELAY_MS = 150;  // pause between batches
const WINDOW = 2000;         // pending rows pulled per pass

const MARK_URL = `${config.xanoIntakeBase}/mark_signal_processed`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lean single-write mark with backoff/retry on Xano 5xx (503s under load).
// Skips the sibling event_log write that xano.markSignalProcessed does, halving
// the request load. Returns true on success.
async function leanMark(id) {
  for (let a = 0; a < 5; a++) {
    try {
      const res = await fetch(MARK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signal_id: id, result_action: 'cleared_stale_backlog', result_json: '' }),
      });
      if (res.ok) return true;
      if (res.status >= 500) { await sleep(500 * (a + 1)); continue; } // back off on 503/5xx
      return false; // 4xx — don't retry
    } catch (_) { await sleep(500 * (a + 1)); }
  }
  return false;
}

// Parse a Xano created_at (epoch-ms number OR ISO string) → ms, or 0 if unknown.
function createdMs(s) {
  const c = s.created_at;
  if (typeof c === 'number') return c;
  if (typeof c === 'string') { const t = Date.parse(c); return Number.isNaN(t) ? 0 : t; }
  return 0;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function report() {
  const items = await xano.fetchPendingSignals(WINDOW);
  const counts = {};
  for (const s of items) {
    const t = String(s.signal_type || '?').toUpperCase();
    counts[t] = (counts[t] || 0) + 1;
  }
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  console.log(`\nPENDING colony_signals (window of ${items.length}):`);
  for (const [t, n] of rows) console.log(`  ${String(n).padStart(6)}  ${t}`);
  console.log(`\n(If the window is exactly ${WINDOW}, there may be more beyond it.)\n`);
}

async function clear() {
  const cutoff = OLDER_MIN > 0 ? Date.now() - OLDER_MIN * 60000 : null;
  const wantType = (s) => TYPES.size === 0 || TYPES.has(String(s.signal_type).toUpperCase());
  const wantAge = (s) => cutoff === null || (createdMs(s) > 0 && createdMs(s) < cutoff);
  const match = (s) => wantType(s) && wantAge(s);

  const desc = [
    TYPES.size ? `type(s): ${[...TYPES].join(', ')}` : 'ALL types',
    cutoff !== null ? `older than ${OLDER_MIN} min` : '(no age filter)',
  ].join(', ');
  console.log(`Clearing — ${desc}  (gentle: concurrency ${CONCURRENCY}, ${BATCH_DELAY_MS}ms/batch)`);

  let ok = 0, failed = 0, lastLog = 0;
  for (let iter = 0; iter < 1000; iter++) {
    const items = await xano.fetchPendingSignals(WINDOW);
    if (!items.length) break;
    const targets = items.filter(match);
    if (!targets.length) break;
    console.log(`pass ${iter + 1}: ${targets.length} matching in this window…`);
    for (const group of chunk(targets, CONCURRENCY)) {
      const results = await Promise.all(group.map((s) => leanMark(s.id)));
      for (const r of results) { if (r) ok++; else failed++; }
      if (ok - lastLog >= 250) { console.log(`… ${ok} cleared (${failed} failed)`); lastLog = ok; }
      await sleep(BATCH_DELAY_MS);
    }
    // If a whole pass cleared nothing (all marks failing), stop — Xano's unhappy.
    if (ok === 0 && failed > 0) { console.error('All marks failing — stopping. Is Xano up?'); break; }
  }
  console.log(`DONE — cleared ${ok} pending signals (${failed} failed).`);
}

async function main() {
  const hasClearIntent = ALL || TYPES.size > 0 || OLDER_MIN > 0;
  if (REPORT || !hasClearIntent) { await report(); return; }
  await clear();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
