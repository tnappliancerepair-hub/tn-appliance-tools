// Off-site backup core — reads Xano tables via the Metadata API and mirrors them
// into SUPABASE (a separate Postgres platform we own). Runs entirely in the cloud
// (Netlify), so it does NOT depend on the Mac Mini (itself a single point of
// failure). Phase 0 of the money/data plan: the independent copy that makes
// retiring Google Sheets safe — and it's queryable, so a job can be pulled back
// out, not just unzipped from a file.
//
// CRITICAL vs the old Mac script (colony-loop/scripts/xano-backup.js): that one
// SKIPS event_log — but event_log is the money ledger (invoices, payments,
// add-ons, payouts). This one backs it up (chunked, so big tables don't blow
// memory or the insert body limit).
//
// Destination table (create once in the Supabase SQL editor):
//   create table if not exists xano_backup_chunks (
//     id bigint generated always as identity primary key,
//     snapshot_date date not null,
//     table_name text not null,
//     table_id int,
//     part int not null default 0,
//     row_count int not null default 0,
//     rows jsonb not null,
//     created_at timestamptz not null default now()
//   );
//   create index if not exists xano_backup_chunks_lookup
//     on xano_backup_chunks (snapshot_date, table_name);
'use strict';

const sb = require('./supabase');

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const EVENT_LOG_TABLE = 3;
const PAGE_SIZE = 200;     // default rows per Xano read page
const CHUNK_ROWS = 500;    // rows per Supabase insert
// Tables with heavy rows (big JSON) need smaller pages so a page response doesn't
// blow the read timeout. parts_orders carries fat order payloads.
const HEAVY_PER_PAGE = { 47: 50 };
const MAX_PAGES = 8000;    // runaway backstop (1.6M rows/table)
const BACKUP_TABLE = 'xano_backup_chunks';
// Retention window (days). Without pruning, every night's full snapshot
// accumulated forever — the table hit ~26k chunks / 978 MB, over half the ops
// DB, and became the #1 autovacuum-churn source that helped melt the Nano tier.
// Keep a rolling N days of point-in-time snapshots; older ones are pruned after
// each run. Tunable via BACKUP_RETENTION_DAYS.
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS) > 0 ? Number(process.env.BACKUP_RETENTION_DAYS) : 7;

// Known table ids → friendly names. Unknown discovered ids fall back to table-<id>.
const NAME_MAP = { 3: 'event_log', 6: 'customer', 7: 'jobs', 15: 'technicians', 46: 'warranty_submissions', 47: 'parts_orders' };
// NEVER back these up: app_config (53) holds vault SECRETS; colony_signals (38) is the transient queue.
const SKIP_IDS = new Set([53, 38]);
// Explicit allowlist of money + business tables (ids confirmed from a full
// discovery run — all small/safe). event_log(3)=money-only, parts_orders(47)=heavy
// (small pages). This is bounded + reliable; discovery is opt-in (?discover) for
// a deeper one-off. Excludes the giant AI/vector tables and secrets/transient.
const CORE_IDS = [
  7, 6, 3, 47, 46, 15,                                  // jobs, customer, event_log, parts_orders, warranty, technicians
  4, 9, 11, 12, 13, 16, 17, 22, 23, 25, 26, 27, 28, 29, // business (TDRs, earnings, clusters, etc.)
  30, 33, 34, 35, 36, 37, 41, 48, 50,
];

function metaHeaders() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

// event_log is the high-churn action ledger — too big to dump whole every night.
// Cap the nightly snapshot to the most-recent rows (where all current money
// activity lives); full-history event_log is a separate one-time/incremental pull.
const EVENT_LOG_PER_PAGE = 100;     // small pages so the giant table's query returns fast (avoids read timeout)
const EVENT_LOG_RECENT_PAGES = 200; // 200 x 100 = up to 20k most-recent rows (recent money activity)

// event_log is a giant, mostly-NOISE action log (plumbing markers, GC'd at 7d).
// Dumping it whole is slow + pointless. Instead back up only the money/business
// rows by action type — fast, and captures the money regardless of age.
const MONEY_ACTIONS = [
  'office_invoice_logged', 'customer_payment_received', 'customer_payment_refunded',
  'tech_payout_recorded', 'tech_tip_paid', 'payout_ready_notified',
  'addon_requested', 'addon_fulfilled', 'addon_voided',
  'quick_check_paid', 'free_quick_check_created', 'warranty_quick_check_created',
  'sp_claim_sync_state', 'line_offer_decision', 'floors_flag', 'offsite_backup_completed',
];

// One page read, with a timeout + one retry (handles transient "fetch failed").
// `search` (optional) = a metadata content/search filter, e.g. { action: 'x' }.
async function readPage(id, page, perPage, sortDir, search) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const body = { per_page: perPage, page, sort: { id: sortDir } };
      if (search) body.search = search;
      const r = await fetch(`${META}/table/${id}/content/search`, {
        method: 'POST', headers: metaHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) return { httpStatus: r.status, items: null };
      const d = await r.json();
      return { items: (d && d.items) || [] };
    } catch (_) {
      if (attempt === 1) return { items: null, errored: true };
    }
  }
  return { items: null, errored: true };
}

// Page a table's content, flushing to onChunk() every CHUNK_ROWS rows.
async function pageTable(id, onChunk, popts) {
  const sortDir = (popts && popts.sort) || 'asc';
  const maxPages = (popts && popts.maxPages) || MAX_PAGES;
  const perPage = (popts && popts.perPage) || PAGE_SIZE;
  let total = 0, part = 0, buf = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await readPage(id, page, perPage, sortDir);
    if (res.items == null) {
      if (page === 1) { if (buf.length) await onChunk(buf, part++); return { ok: false, status: res.httpStatus, total, parts: part }; }
      break; // mid-table read failure: keep what we have
    }
    const items = res.items;
    buf.push(...items); total += items.length;
    if (buf.length >= CHUNK_ROWS) { await onChunk(buf, part++); buf = []; }
    if (items.length < perPage) break;
  }
  if (buf.length) { await onChunk(buf, part++); }
  return { ok: true, total, parts: part };
}

// Back up event_log's MONEY rows only — one fast filtered query per action type.
// `actions` (optional) limits to a subset — for bite-sized runs.
async function pageEventLogMoney(onChunk, actions) {
  let total = 0, part = 0, buf = [];
  const perPage = 200;
  const list = (actions && actions.length) ? actions : MONEY_ACTIONS;
  for (const action of list) {
    for (let page = 1; page <= 200; page++) {
      const res = await readPage(EVENT_LOG_TABLE, page, perPage, 'asc', { action });
      if (res.items == null) break;
      buf.push(...res.items); total += res.items.length;
      if (buf.length >= CHUNK_ROWS) { await onChunk(buf, part++); buf = []; }
      if (res.items.length < perPage) break;
    }
  }
  if (buf.length) { await onChunk(buf, part++); }
  return { ok: true, total, parts: part };
}

// The metadata token is content-scoped (GET /table list returns 403), so we
// can't enumerate tables — probe a candidate id range, sample one row, keep the id
// + its column names so we can shape-skip the giant AI/noise tables.
async function discoverTables() {
  const out = [];
  for (let id = 1; id <= 60; id++) {
    if (SKIP_IDS.has(id)) continue;
    try {
      const r = await fetch(`${META}/table/${id}/content/search`, {
        method: 'POST', headers: metaHeaders(), body: JSON.stringify({ per_page: 1, page: 1 }),
      });
      if (!r.ok) continue;
      const d = await r.json();
      const sample = ((d && d.items) || [])[0] || null;
      out.push({ id, keys: sample ? Object.keys(sample) : [] });
    } catch (_) {}
  }
  return out;
}

// Skip the big/irrelevant tables this is NOT meant to back up (they're either
// huge — embeddings/vector store — or AI/plumbing noise, not money/business data).
function shouldSkipByShape(keys) {
  const k = new Set(keys);
  if (k.has('embedding') || k.has('vector') || k.has('embedding_vector')) return true; // vector store (huge)
  if (k.has('signal_type')) return true;                       // colony_signals (transient)
  if (k.has('role') && k.has('content')) return true;          // agent_message
  if (k.has('cost_usd') || k.has('prompt_tokens') || k.has('total_tokens')) return true; // claude_call_log
  if (k.has('value') && k.has('name') && keys.length <= 4) return true; // app_config (secrets)
  return false;
}

// Wipe an existing same-day snapshot so a re-run is idempotent (no dup chunks).
async function clearSnapshot(date) {
  const c = await sb.cfg();
  if (!c.url || !c.key) throw new Error('supabase_not_configured');
  await fetch(`${c.url}/rest/v1/${BACKUP_TABLE}?snapshot_date=eq.${encodeURIComponent(date)}`, {
    method: 'DELETE',
    headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, Prefer: 'return=minimal' },
    signal: AbortSignal.timeout(12000),
  }).catch(() => {});
}

// Prune snapshots older than the retention window so the backup table can't grow
// unbounded. Deletes by snapshot_date (bounded, no row enumeration). Best-effort:
// a prune failure must never fail the backup itself.
async function pruneOldSnapshots(keepDays = RETENTION_DAYS) {
  const c = await sb.cfg();
  if (!c.url || !c.key) return { pruned: false, reason: 'not_configured' };
  const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString().slice(0, 10);
  const r = await fetch(`${c.url}/rest/v1/${BACKUP_TABLE}?snapshot_date=lt.${cutoff}`, {
    method: 'DELETE',
    headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, Prefer: 'return=minimal' },
    signal: AbortSignal.timeout(20000),
  });
  return { pruned: r.ok, cutoff, keepDays };
}

// Run a backup. opts.only = [ids] for a scoped run (probe/verify); else core+discovered.
async function backupTables(opts = {}) {
  if (!(await sb.isConnected())) throw new Error('supabase_not_configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY)');
  const date = opts.date || new Date().toISOString().slice(0, 10);

  // Default: the explicit money/business allowlist (bounded + reliable).
  // ?discover adds shape-filtered discovery of any other tables for a deeper one-off.
  let ids = (opts.only && opts.only.length) ? opts.only : [...CORE_IDS];
  if (!opts.only && opts.discover) {
    const discovered = await discoverTables();
    const keep = discovered.filter((t) => !shouldSkipByShape(t.keys)).map((t) => t.id);
    ids = Array.from(new Set([...CORE_IDS, ...keep])).filter((id) => !SKIP_IDS.has(id));
  }

  // Only wipe the day's snapshot when explicitly asked (opts.clearFirst). Auto-
  // clearing made concurrent/repeated runs delete each other's progress mid-flight.
  // The nightly cron is a single run, so duplicate chunks aren't a concern in practice.
  if (opts.clearFirst) await clearSnapshot(date);

  const summary = { date, started_at: new Date().toISOString(), tables: [] };
  for (const id of ids) {
    const name = NAME_MAP[id] || ('table-' + id);
    // Isolate each table: one failure (e.g. a too-big insert) must NOT abort the
    // whole backup or skip the manifest. Record it and move on.
    const isEventLog = (id === EVENT_LOG_TABLE);
    const insertChunk = async (rows, part) => {
      await sb.insert(BACKUP_TABLE, { snapshot_date: date, table_name: name, table_id: id, part, row_count: rows.length, rows });
    };
    try {
      // event_log = money rows only (fast, by action). Everything else = full table.
      const res = isEventLog
        ? await pageEventLogMoney(insertChunk, opts.actions)
        : await pageTable(id, insertChunk, { sort: 'asc', maxPages: opts.maxPagesOverride || MAX_PAGES, perPage: opts.perPage || HEAVY_PER_PAGE[id] || PAGE_SIZE });
      summary.tables.push({ id, name, ok: res.ok, rows: res.total || 0, parts: res.parts || 0, status: res.status, money_only: isEventLog || undefined });
    } catch (e) {
      summary.tables.push({ id, name, ok: false, rows: 0, parts: 0, error: String((e && e.message) || e).slice(0, 300) });
    }
  }
  summary.finished_at = new Date().toISOString();
  summary.total_rows = summary.tables.reduce((s, t) => s + (t.rows || 0), 0);

  // manifest row for this snapshot (table_name='_manifest')
  await sb.insert(BACKUP_TABLE, { snapshot_date: date, table_name: '_manifest', table_id: null, part: 0, row_count: summary.tables.length, rows: summary });

  // Retention: prune snapshots older than the window (keeps the backup table
  // bounded — it had grown to ~1GB with no pruning). Best-effort — never fail the
  // backup on a prune error.
  try { summary.pruned = await pruneOldSnapshots(); } catch (e) { summary.prune_error = String((e && e.message) || e).slice(0, 200); }

  if (opts.writeAudit) {
    try {
      await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
        method: 'POST', headers: metaHeaders(),
        body: JSON.stringify({
          action: 'offsite_backup_completed',
          metadata: { date, total_rows: summary.total_rows, tables: summary.tables.length, dest: 'supabase', at_ms: Date.now() },
        }),
      });
    } catch (_) {}
  }
  return summary;
}

module.exports = { backupTables, pruneOldSnapshots };
