// platform-backup — off-PROJECT snapshot of the ANT Platforms (Supabase) tables
// into the ops Supabase project's xano_backup_chunks table.
//
// WHY a second copy when Supabase Pro already keeps daily backups:
//   Supabase's own backup is a whole-project point-in-time restore, in the same
//   vendor + same account. It is the right tool for "the project is gone". It is
//   the WRONG tool for the failure we actually keep hitting -- a bad logical
//   write. Twice on 2026-09-10 alone: the mirror erasing office edits, and a
//   re-read window + unguarded insert producing 14,160 junk thread_message rows.
//   Recovering from those via PITR means rolling the whole project back and
//   losing every legitimate write since. A per-table logical snapshot in a
//   DIFFERENT project lets you restore one table, or diff to find what a bad
//   writer did. The whole platform DB is ~25 MB, so this costs nothing.
//
// Rows land as table_name='platform.<table>' alongside the Xano chunks, so they
// share the existing 7-day retention prune (which is keyed on snapshot_date).
'use strict';

const sb = require('./supabase');            // ops project (SUPABASE_URL / SERVICE_KEY)
const { cfg } = require('./platform-rest');  // ANT Platforms creds

const BACKUP_TABLE = 'xano_backup_chunks';
const PAGE = 1000;      // PostgREST caps a response at 1000 rows server-side
const CHUNK_ROWS = 500; // rows per ops insert
const BUDGET_MS = Number(process.env.PLATFORM_BACKUP_BUDGET_MS) > 0
  ? Number(process.env.PLATFORM_BACKUP_BUDGET_MS) : 3 * 60 * 1000;

// NEVER copy these. app_config is the VAULT (secrets). tenant_keyring holds
// wrapped DEKs and tenant_integration holds secret_enc ciphertext -- encrypted
// or not, secrets do not get duplicated into a second store. company_credential
// is credential/insurance docs. portal_grant is live customer access tokens:
// regenerable, so copying them only widens exposure.
const SKIP = new Set(['app_config', 'tenant_keyring', 'tenant_integration', 'company_credential', 'portal_grant']);

// Tables big enough to need ordered paging. `.range()`/offset without ORDER BY
// can skip or duplicate rows between pages -- every table here has `id`.
const ORDER_COL = 'id';

function H(key) { return { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }; }

// Discover the exposed tables from PostgREST's own root spec rather than a
// hardcoded list, so a table added later cannot silently go unbacked. The
// discovered-vs-copied lists both land in the manifest.
async function discover(url, key) {
  const r = await fetch(`${url}/rest/v1/`, { headers: H(key), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('discover ' + r.status);
  const spec = await r.json();
  const src = spec.definitions || spec.components?.schemas || {};
  return Object.keys(src).filter((t) => !t.startsWith('(') && !t.includes('.')).sort();
}

async function pageTable(url, key, table, onChunk, deadline) {
  let offset = 0, total = 0, part = 0, buf = [], truncated = false;
  for (;;) {
    if (Date.now() > deadline) { truncated = true; break; }
    const q = `${url}/rest/v1/${table}?select=*&order=${ORDER_COL}.asc&limit=${PAGE}&offset=${offset}`;
    const r = await fetch(q, { headers: H(key), signal: AbortSignal.timeout(20000) });
    if (!r.ok) {
      // A table without `id` (or otherwise unorderable) still gets one unordered
      // page rather than being dropped -- being partial is fine, being silently
      // absent is not.
      if (offset === 0) {
        const r2 = await fetch(`${url}/rest/v1/${table}?select=*&limit=${PAGE}`, { headers: H(key), signal: AbortSignal.timeout(20000) });
        if (!r2.ok) throw new Error(`${table} ${r.status}`);
        const rows2 = await r2.json();
        if (rows2.length) { await onChunk(rows2, part++); total += rows2.length; }
        return { total, parts: part, unordered: true, truncated: rows2.length >= PAGE };
      }
      break;
    }
    const rows = await r.json();
    if (!rows.length) break;
    buf.push(...rows); total += rows.length; offset += rows.length;
    while (buf.length >= CHUNK_ROWS) { await onChunk(buf.splice(0, CHUNK_ROWS), part++); }
    if (rows.length < PAGE) break;
  }
  if (buf.length) await onChunk(buf, part++);
  return { total, parts: part, truncated };
}

async function backupPlatform(opts = {}) {
  const { url, key } = await cfg();
  if (!url || !key) throw new Error('platform_not_configured');
  if (!(await sb.isConnected())) throw new Error('ops_supabase_not_configured');

  const date = opts.date || new Date().toISOString().slice(0, 10);
  const t0 = Date.now();
  const all = await discover(url, key);
  const wanted = all.filter((t) => !SKIP.has(t));

  const summary = {
    date, source: 'platform', started_at: new Date().toISOString(),
    discovered: all.length, skipped_secrets: all.filter((t) => SKIP.has(t)),
    tables: [], complete: true, skipped_budget: [], budget_ms: BUDGET_MS,
  };

  for (const t of wanted) {
    if (Date.now() - t0 > BUDGET_MS) { summary.skipped_budget.push(t); summary.complete = false; continue; }
    const name = 'platform.' + t;
    try {
      const res = await pageTable(url, key, t, async (rows, part) => {
        await sb.insert(BACKUP_TABLE, { snapshot_date: date, table_name: name, table_id: null, part, row_count: rows.length, rows });
      }, t0 + BUDGET_MS);
      summary.tables.push({ name: t, rows: res.total, parts: res.parts, unordered: res.unordered || undefined, truncated: res.truncated || undefined });
      if (res.truncated) summary.complete = false;
    } catch (e) {
      // Isolate: one table must never abort the run or cost us the manifest.
      summary.tables.push({ name: t, rows: 0, parts: 0, error: String((e && e.message) || e).slice(0, 200) });
      summary.complete = false;
    }
  }

  summary.finished_at = new Date().toISOString();
  summary.total_rows = summary.tables.reduce((s, t) => s + (t.rows || 0), 0);
  // Always write the manifest, complete or not -- a partial run must be
  // distinguishable from a run that never happened.
  await sb.insert(BACKUP_TABLE, { snapshot_date: date, table_name: '_manifest_platform', table_id: null, part: 0, row_count: summary.tables.length, rows: summary });
  return summary;
}

module.exports = { backupPlatform, SKIP };
