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
const PAGE_SIZE = 500;     // rows per Xano read page (fewer round-trips on big tables)
const CHUNK_ROWS = 500;    // rows per Supabase insert — one insert per page; small enough for big-metadata rows
const MAX_PAGES = 8000;    // runaway backstop (1.6M rows/table)
const BACKUP_TABLE = 'xano_backup_chunks';

// Known table ids → friendly names. Unknown discovered ids fall back to table-<id>.
const NAME_MAP = { 3: 'event_log', 6: 'customer', 7: 'jobs', 15: 'technicians', 46: 'warranty_submissions', 47: 'parts_orders' };
// NEVER back these up: app_config (53) holds vault SECRETS; colony_signals (38) is the transient queue.
const SKIP_IDS = new Set([53, 38]);
// Money + business core we always include (probe discovers the rest).
const CORE_IDS = [7, 6, 3, 47, 46, 15];

function metaHeaders() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

// Page a table's content, flushing to onChunk() every CHUNK_ROWS rows.
async function pageTable(id, onChunk) {
  let total = 0, part = 0, buf = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let r;
    try {
      r = await fetch(`${META}/table/${id}/content/search`, {
        method: 'POST', headers: metaHeaders(),
        body: JSON.stringify({ per_page: PAGE_SIZE, page, sort: { id: 'asc' } }),
      });
    } catch (_) { break; }
    if (!r.ok) { if (page === 1) return { ok: false, status: r.status, total: 0, parts: 0 }; break; }
    const d = await r.json();
    const items = (d && d.items) || [];
    buf.push(...items); total += items.length;
    if (buf.length >= CHUNK_ROWS) { await onChunk(buf, part++); buf = []; }
    if (items.length < PAGE_SIZE) break;
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

// Run a backup. opts.only = [ids] for a scoped run (probe/verify); else core+discovered.
async function backupTables(opts = {}) {
  if (!(await sb.isConnected())) throw new Error('supabase_not_configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY)');
  const date = opts.date || new Date().toISOString().slice(0, 10);

  let ids = (opts.only && opts.only.length) ? opts.only : null;
  if (!ids) {
    const discovered = await discoverTables();
    const keep = discovered.filter((t) => !shouldSkipByShape(t.keys)).map((t) => t.id);
    // CORE money/business tables always; plus discovered business tables (TDRs,
    // tech_earnings, etc.); minus the giant AI/noise tables.
    ids = Array.from(new Set([...CORE_IDS, ...keep])).filter((id) => !SKIP_IDS.has(id));
  }

  if (!opts.keepExisting) await clearSnapshot(date);

  const summary = { date, started_at: new Date().toISOString(), tables: [] };
  for (const id of ids) {
    const name = NAME_MAP[id] || ('table-' + id);
    // Isolate each table: one failure (e.g. a too-big insert) must NOT abort the
    // whole backup or skip the manifest. Record it and move on.
    try {
      const res = await pageTable(id, async (rows, part) => {
        await sb.insert(BACKUP_TABLE, { snapshot_date: date, table_name: name, table_id: id, part, row_count: rows.length, rows });
      });
      summary.tables.push({ id, name, ok: res.ok, rows: res.total || 0, parts: res.parts || 0, status: res.status });
    } catch (e) {
      summary.tables.push({ id, name, ok: false, rows: 0, parts: 0, error: String((e && e.message) || e).slice(0, 300) });
    }
  }
  summary.finished_at = new Date().toISOString();
  summary.total_rows = summary.tables.reduce((s, t) => s + (t.rows || 0), 0);

  // manifest row for this snapshot (table_name='_manifest')
  await sb.insert(BACKUP_TABLE, { snapshot_date: date, table_name: '_manifest', table_id: null, part: 0, row_count: summary.tables.length, rows: summary });

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

module.exports = { backupTables };
