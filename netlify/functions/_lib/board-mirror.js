// _lib/board-mirror — the sync logic that keeps Supabase `board_mirror` fresh from
// Xano's get_office_kanban. Lives in a lib so BOTH the HTTP-callable core
// (board-mirror-sync, for manual test/kick) and the scheduled wrapper
// (board-mirror-sync-cron) share it — the proven pattern that dodges the Netlify
// "scheduled functions edge-403 on manual HTTP" footgun.
'use strict';

const sb = require('./supabase');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

const NUM = new Set(['id', 'customer_id', 'technician_id', 'created_at', 'job_completed_at', 'scheduled_start']);
const BOOL = new Set(['parallel_mode']);
const COLS = [
  'id', 'appliance', 'brand', 'claim_number', 'created_at', 'current_status',
  'customer_first', 'customer_id', 'customer_last', 'customer_phone',
  'customer_preference_text', 'dispatch_source_id', 'intake_source',
  'job_completed_at', 'office_stage', 'parallel_mode', 'parts_eta_date',
  'parts_status', 'problem_summary', 'scheduled_start', 'scheduling_status',
  'service_city', 'service_eta_window', 'service_state', 'service_zip',
  'technician_id', 'warranty_company',
];

function shape(j) {
  const row = {};
  for (const c of COLS) {
    let v = j[c];
    if (NUM.has(c)) {
      const n = Number(v);
      v = Number.isFinite(n) ? n : (c === 'id' ? undefined : 0);
    } else if (BOOL.has(c)) {
      v = !!v;
    } else {
      v = v == null ? '' : String(v);
      if (c === 'problem_summary' && v.length > 120) v = v.slice(0, 120) + '…';
      if (c === 'customer_preference_text' && v.length > 160) v = v.slice(0, 160) + '…';
    }
    row[c] = v;
  }
  return row;
}

// get_office_kanban is Xano's heaviest query and it has been getting slower: measured at
// 6.9s / 13.2s / 24.3s in early Sept and at 43.8s (779KB) on 2026-09-10 while the office was
// live. At a 24s cap EVERY run aborted, so board_mirror went 21 minutes stale and the office
// board served old jobs - which is what "the old system won't load" actually was.
//
// Aborting does NOT save Xano anything. Xano has already run the query by the time we give
// up; dropping the connection just throws the answer away and leaves the mirror stale, so we
// pay the compute AND get nothing. Waiting converts that same spend into a fresh mirror.
//
// Safe to wait: the caller that matters is the SCHEDULED cron, which has minutes, not the 26s
// an HTTP function gets. Env-tunable so this can be pulled back without a deploy.
//
// The wait is per-CALLER, not global. board-mirror-sync IS the office board's data source, so
// it waits the full budget - a stale board is the visible failure. platform-tn-mirror only
// uses this feed for EXTRAS (older/completed jobs); its own supplemental pull off the raw
// jobs table is faster and carries more (model, serial, street, claim), so it passes a short
// wait and lets the slow feed go rather than spending its whole run on it. (2026-09-10)
const KANBAN_TIMEOUT_MS = Number(process.env.BOARD_MIRROR_KANBAN_TIMEOUT_MS || 70000);
async function fetchKanban(timeoutMs, daysBack) {
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : KANBAN_TIMEOUT_MS;
  const qs = (daysBack === undefined || daysBack === null) ? '' : `?days_back=${Number(daysBack)}`;
  const r = await fetch(`${XANO}/get_office_kanban${qs}`, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('xano_' + r.status);
  const d = await r.json();
  return Array.isArray(d.items) ? d.items : [];
}

// THE 800-ROW CEILING, AND WHY ONE QUERY CANNOT CLEAR IT.
//
// get_office_kanban returns `page 1, per_page 800` sorted `created_at desc` - so it is
// the 800 NEWEST-CREATED jobs, not "the board". That was fine at 300-500 jobs. It is not
// fine now: measured 2026-09-16 the feed came back with EXACTLY 800 rows, of which 364
// were COMPLETED jobs inside the 60-day invoice window. Finished work was eating 45% of
// the board's capacity, and 309 jobs that are eligible for the board - 195 scheduled,
// 72 awaiting parts, 36 in progress, 293 of them booked with a day AND a tech - fell off
// the bottom. Nothing was deleted; the office simply could not see them. That is what
// "the jobs I scheduled disappeared" actually was.
//
// Raising per_page is the obvious move and it is the wrong one: it is a Xano-side change
// (manual push) on this workspace's heaviest, most saturation-prone query, and it grows
// the payload for every reader forever.
//
// Instead take TWO cheap passes and merge:
//   days_back=0  -> the completed window collapses to "completed since right now", so
//                   effectively NO completed jobs qualify and all 800 slots go to open
//                   work. Measured: 745 open jobs, comfortably under the cap, complete.
//   days_back=60 -> the normal mixed feed, which is what carries the finished jobs each
//                   tech's Invoice column needs.
// Union by id = every open job plus the invoice window, with room to spare.
//
// Run them SEQUENTIALLY, never in parallel. This endpoint measured 3-4s alone and 8-15s
// at six concurrent readers; firing two heavy queries at once is how we saturate Xano and
// make WRITES time out. The caller here is a cron with minutes to spend.
//
// Returns { items, complete }. `complete` is false when either pass failed, and the
// caller MUST NOT prune on an incomplete read - a failed half looks exactly like "those
// jobs are gone" and would delete good rows out of the mirror.
async function fetchKanbanFull(timeoutMs) {
  let open = null, windowed = null;
  try { open = await fetchKanban(timeoutMs, 0); } catch (_) {}
  try { windowed = await fetchKanban(timeoutMs); } catch (_) {}

  const complete = Array.isArray(open) && Array.isArray(windowed);
  const byId = new Map();
  // windowed first, then open overwrites - open is the pass that matters for live work.
  for (const src of [windowed, open]) {
    if (!Array.isArray(src)) continue;
    for (const j of src) {
      const id = Number(j && j.id);
      if (Number.isFinite(id)) byId.set(id, j);
    }
  }
  return { items: Array.from(byId.values()), complete };
}

// Read EVERY id out of board_mirror, not the first page. PostgREST caps a response at
// 1000 rows server-side no matter what `limit` asks for, and the mirror now holds more
// than that - so a single read silently returns a truncated set. Truncation here only
// ever under-prunes (the safe direction), but it leaves finished jobs lingering on the
// board, so page it properly.
async function allMirrorIds() {
  const out = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const page = await sb.select('board_mirror', { select: 'id', limit: '1000', offset: String(offset) });
    if (!Array.isArray(page) || !page.length) break;
    for (const r of page) out.push(r.id);
    if (page.length < 1000) break;
  }
  return out;
}

// Pull the heavy Xano query once, upsert every job into board_mirror, prune the
// jobs that fell off the feed. Returns { ok, synced, pruned, ms }.
async function syncBoardMirror() {
  const t0 = Date.now();
  const { items, complete } = await fetchKanbanFull();
  if (!items.length) return { ok: false, error: 'empty_feed', ms: Date.now() - t0 };

  // Stamp every row with this run's timestamp so max(synced_at) is a TRUE heartbeat
  // (was default-now() on insert only, which read as "stale" even while the sync ran
  // fine — jobs just hadn't changed). Now "is the mirror current / still receiving
  // Xano?" is a reliable one-query check during the crossover.
  const syncedAt = new Date().toISOString();
  const rows = items.map(shape).filter((x) => x.id != null).map((r) => ({ ...r, synced_at: syncedAt }));
  const ids = rows.map((x) => x.id);

  await sb.upsert('board_mirror', rows, { onConflict: 'id' });

  // Only prune when BOTH passes came back. On a half-read the missing half is not
  // "jobs that went away", it is a query that failed - pruning on it would delete real
  // work out of the mirror. Upserting what we did get is always safe; deleting is not.
  let pruned = 0;
  try {
    if (!complete) throw new Error('incomplete_feed_skip_prune');
    const existing = (await allMirrorIds()).map((id) => ({ id }));
    const live = new Set(ids);
    const stale = existing.map((x) => x.id).filter((id) => !live.has(id));
    for (let i = 0; i < stale.length; i += 200) {
      const chunk = stale.slice(i, i + 200);
      await sb.del('board_mirror', { id: `in.(${chunk.join(',')})` });
      pruned += chunk.length;
    }
  } catch (_) { /* prune best-effort */ }

  return { ok: true, synced: rows.length, pruned, complete, ms: Date.now() - t0 };
}

module.exports = { syncBoardMirror, fetchKanban, fetchKanbanFull, allMirrorIds, shape, COLS };
