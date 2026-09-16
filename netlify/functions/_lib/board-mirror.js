// _lib/board-mirror — the sync logic that keeps Supabase `board_mirror` fresh from
// Xano's get_office_kanban. Lives in a lib so BOTH the HTTP-callable core
// (board-mirror-sync, for manual test/kick) and the scheduled wrapper
// (board-mirror-sync-cron) share it — the proven pattern that dodges the Netlify
// "scheduled functions edge-403 on manual HTTP" footgun.
'use strict';

const sb = require('./supabase');
const { getSecret } = require('./secrets');

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

// THE 800-ROW CEILING, AND WHY WE STOPPED DEPENDING ON IT.
//
// get_office_kanban returns `page 1, per_page 800` sorted `created_at desc` - so it is
// the 800 NEWEST-CREATED jobs, not "the board". Measured 2026-09-16 the feed came back
// with EXACTLY 800 rows, of which 364 were COMPLETED jobs inside the 60-day invoice
// window. Finished work was eating 45% of the board's capacity and 309 board-eligible
// jobs fell off the bottom - 195 scheduled, 72 awaiting parts, 36 in progress, 293 of
// them booked with a day AND a tech. Nothing was deleted; the office simply could not
// see them. That is what "the jobs I scheduled disappeared" actually was.
//
// A bigger cap is not a fix, it is the same bug with a later due date. This shop creates
// ~300 jobs a month (measured: Jul 271, Aug 331, Sep 198) and jobs stay open for weeks,
// so the open set only grows. The cap went 300 -> 800 in July when the board held ~470.
// It hit 800 in September. There is no number that stays right.
//
// So the mirror no longer DEPENDS on that feed for completeness. Two sources, merged:
//
//   RAW WALK (authoritative for completeness, NO CAP) - page Xano's jobs table directly
//     through the Metadata API, 500 at a time, until a short page ends it. Every board
//     status, plus completed filtered to the same 60-day window the feed uses. This is
//     the proven pattern platform-tn-mirror already runs, and it has no ceiling.
//
//   KANBAN FEED (authoritative for FRESHNESS) - get_office_kanban computes the customer
//     name with a live lookup when the denormalized copy on the row is still blank, which
//     it is for up to 30 minutes on a brand-new job. Feed rows therefore WIN on conflict;
//     the raw walk only fills in what the capped feed could not reach.
//
// Run them SEQUENTIALLY, never in parallel. get_office_kanban measured 3-4s alone and
// 8-15s at six concurrent readers, and saturating Xano is what makes WRITES time out.
//
// Returns { items, complete, raw_count, feed_count }. `complete` is false when either
// source failed, and the caller MUST NOT prune on an incomplete read - a failed half
// looks exactly like "those jobs are gone" and would delete good rows out of the mirror.

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
// The statuses the office board renders. Mirrors get_office_kanban's WHERE clause so the
// raw walk and the feed agree on what belongs on the board.
const BOARD_STATUSES = [
  'not_ready', 'needs_scheduled', 'scheduled', 'in_progress',
  'awaiting_parts', 'held', 'no_fix_possible',
];
const COMPLETED_WINDOW_DAYS = Number(process.env.BOARD_COMPLETED_WINDOW_DAYS || 60);
// Runaway guard only - NOT a data cap. 500/page x 200 pages = 100k rows per status, far
// past anything real. A page loop with no bound is how one bad response spins forever.
const MAX_PAGES = 200;

async function rawWalk(timeoutMs) {
  const token = (await getSecret('XANO_METADATA_TOKEN')) || process.env.XANO_METADATA_TOKEN;
  if (!token) return null;
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const perPage = 500;
  const ms = Number(timeoutMs) > 0 ? Math.min(Number(timeoutMs), 20000) : 15000;

  // One retry per page, then RETURN NULL. A lost page must never masquerade as
  // "end of the table" - that is silent data loss, and it is what this whole fix exists
  // to stop. Null propagates up and turns off pruning for the run.
  const getPage = async (status, page, attempt = 0) => {
    try {
      const r = await fetch(`${META}/table/7/content/search`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ search: { scheduling_status: status }, sort: { id: 'desc' }, per_page: perPage, page }),
        signal: AbortSignal.timeout(ms),
      });
      if (!r.ok) throw new Error('meta_' + r.status);
      return (await r.json()).items || [];
    } catch (e) {
      if (attempt < 1) return getPage(status, page, attempt + 1);
      console.error('[board-mirror] raw page lost: ' + status + ' p' + page + ' ' + String((e && e.message) || e).slice(0, 80));
      return null;
    }
  };

  const cutoff = Date.now() - COMPLETED_WINDOW_DAYS * 86400000;
  const out = [];
  const seen = new Set();
  let lost = false;

  for (const status of BOARD_STATUSES.concat(['completed'])) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const rows = await getPage(status, page);
      if (rows == null) { lost = true; break; }
      if (!rows.length) break;
      for (const j of rows) {
        const id = Number(j && j.id);
        if (!Number.isFinite(id) || seen.has(id)) continue;
        // Completed jobs ride only inside the invoice window, matching the feed. The
        // created_at fallback is deliberate: a job marked completed whose completion flow
        // never stamped job_completed_at would fail "null >= cutoff" and vanish.
        if (status === 'completed') {
          const done = Number(j.job_completed_at || 0);
          const made = Number(j.created_at || 0);
          if (!(done >= cutoff || made >= cutoff)) continue;
        }
        seen.add(id);
        // The raw table calls it appliance_type; the feed calls it appliance. Same field.
        j.appliance = (j.appliance != null && j.appliance !== '') ? j.appliance : String(j.appliance_type || '');
        out.push(j);
      }
      if (rows.length < perPage) break;
    }
    if (lost) break;
  }
  return lost ? null : out;
}

async function fetchKanbanFull(timeoutMs) {
  let raw = null, feed = null;
  try { raw = await rawWalk(timeoutMs); } catch (_) {}
  try { feed = await fetchKanban(timeoutMs); } catch (_) {}

  const complete = Array.isArray(raw) && Array.isArray(feed);
  const byId = new Map();
  // raw first (completeness), then feed overwrites (freshest computed names).
  for (const src of [raw, feed]) {
    if (!Array.isArray(src)) continue;
    for (const j of src) {
      const id = Number(j && j.id);
      if (Number.isFinite(id)) byId.set(id, j);
    }
  }
  return {
    items: Array.from(byId.values()),
    complete,
    raw_count: Array.isArray(raw) ? raw.length : null,
    feed_count: Array.isArray(feed) ? feed.length : null,
  };
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
  const { items, complete, raw_count, feed_count } = await fetchKanbanFull();
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

  return { ok: true, synced: rows.length, pruned, complete, raw_count, feed_count, ms: Date.now() - t0 };
}


// Read-only probe: pull ONE real row off Xano's raw jobs table and report which of the
// COLS the board needs are actually present on it. Sourcing the mirror off the raw table
// is how the 800 cap goes away for good, but only if the row carries the same fields the
// computed feed does - a quietly missing column is the same disappearing-jobs bug wearing
// a different hat.
async function probeRawJobs() {
  const token = (await getSecret('XANO_METADATA_TOKEN')) || process.env.XANO_METADATA_TOKEN;
  if (!token) return { ok: false, error: 'no_metadata_token' };
  const r = await fetch(`${META}/table/7/content/search`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ search: { scheduling_status: 'scheduled' }, sort: { id: 'desc' }, per_page: 1, page: 1 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) return { ok: false, error: 'meta_' + r.status };
  const d = await r.json();
  const row = (d.items || [])[0];
  if (!row) return { ok: false, error: 'no_row' };
  const keys = Object.keys(row);
  const present = COLS.filter((c) => keys.includes(c));
  const missing = COLS.filter((c) => !keys.includes(c));
  // near-miss names for anything missing, so a rename is obvious rather than silent
  const hints = {};
  for (const m of missing) {
    const stem = m.split('_')[0];
    hints[m] = keys.filter((k) => k.includes(stem)).slice(0, 6);
  }
  return { ok: true, total_columns: keys.length, cols_needed: COLS.length, present: present.length, missing, hints };
}

module.exports = { syncBoardMirror, fetchKanban, fetchKanbanFull, allMirrorIds, probeRawJobs, shape, COLS };
