// denorm-job-customer — kill the get_office_kanban N+1 (a db.get customer PER job,
// up to 300 round-trips every 30s poll). We denormalize customer_first/last/phone onto
// the jobs row so the board reads the name with ZERO customer lookups.
//
// The kanban XS read falls back to a live lookup when the denorm field is empty, so a
// name ALWAYS shows — this backfill just makes the fast path hit for the 99%.
//
// Admin-gated (VAPI_ADMIN_SECRET). Modes:
//   ?action=addcols   -> try to add customer_first/last/phone to jobs (table 7) via the
//                        schema API, then verify. If it fails, add them in the Xano UI.
//   ?action=backfill  -> write denorm from the customer table onto jobs, newest-first,
//                        time-boxed ~22s. Follow next_page until done=true. (default)
//   ?action=sweep     -> only jobs still MISSING a denorm name (cheap; for the cron).
//   &per=120 &page=1
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret, getSecretPreferVault } = require('./_lib/secrets');

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const JOBS = 7;
const COLS = ['customer_first', 'customer_last', 'customer_phone'];

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(b, null, 2) }; }
// Vault-FIRST token read: a schema-scoped token vaulted via admin-secrets overrides the
// (content-scoped) Netlify env var. That's how we get schema (add-column) permission.
async function metaToken() {
  let t = null;
  try { t = await getSecretPreferVault('XANO_METADATA_TOKEN'); } catch (_) {}
  t = t || process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return t;
}
async function metaHeaders() {
  return { Authorization: 'Bearer ' + (await metaToken()), 'Content-Type': 'application/json' };
}

// Read the jobs table schema -> list of existing column names.
async function existingCols() {
  const r = await fetch(`${META}/table/${JOBS}/schema`, { headers: await metaHeaders(), signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('schema GET ' + r.status);
  const d = await r.json().catch(() => []);
  const arr = Array.isArray(d) ? d : (d && d.schema) || [];
  return arr.map((f) => (f && f.name) || '').filter(Boolean);
}

async function addCols() {
  const envTok = process.env.XANO_METADATA_TOKEN || '';
  let vaultTok = '';
  try { vaultTok = (await getSecretPreferVault('XANO_METADATA_TOKEN')) || ''; } catch (_) {}
  const diag = { env_tail: envTok ? envTok.slice(-6) : null, vault_tail: vaultTok ? vaultTok.slice(-6) : null, using: vaultTok ? 'vault' : (envTok ? 'env' : 'none') };
  let have;
  try { have = await existingCols(); } catch (e) { return { ok: false, stage: 'read_schema', error: String(e.message || e), token: diag, hint: 'this token lacks schema scope — vault a schema-scoped XANO_METADATA_TOKEN via admin-secrets.html, or add the 3 cols in the UI' }; }
  const results = [];
  for (const name of COLS) {
    if (have.includes(name)) { results.push({ name, status: 'already_exists' }); continue; }
    try {
      const r = await fetch(`${META}/table/${JOBS}/schema/type/text`, {
        method: 'POST', headers: await metaHeaders(),
        body: JSON.stringify({ name, description: 'denormalized from customer for fast board reads', nullable: true, default: null, required: false }),
        signal: AbortSignal.timeout(12000),
      });
      const t = await r.text().catch(() => '');
      results.push({ name, status: r.status, body: t.slice(0, 160) });
    } catch (e) { results.push({ name, status: 'error', error: String(e.message || e) }); }
  }
  let after = [];
  try { after = await existingCols(); } catch (_) {}
  const allThere = COLS.every((c) => after.includes(c));
  return { ok: allThere, results, columns_present: COLS.filter((c) => after.includes(c)), hint: allThere ? 'columns ready — run ?action=backfill' : 'schema API did not add all cols; add the missing ones in the Xano UI (jobs table -> add text field)' };
}

// Metadata content-LIST GET (no search filter — an empty search 400s). Returns the
// page's rows regardless of the wrapper shape. Pages until an empty page.
async function contentPage(tableId, page, perPage) {
  const r = await fetch(`${META}/table/${tableId}/content?page=${page}&per_page=${perPage}`, { headers: await metaHeaders(), signal: AbortSignal.timeout(20000) });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('content GET ' + tableId + ' -> ' + r.status + ' ' + t.slice(0, 120)); }
  const d = await r.json().catch(() => ({}));
  return Array.isArray(d) ? d : (d.items || []);
}

// Load every customer into an id -> {first,last,phone} map.
async function loadCustomerMap() {
  const map = new Map();
  for (let p = 1; p <= 60; p++) {
    const rows = await contentPage(crud.TABLES.customer, p, 500);
    if (!rows || !rows.length) break;
    for (const c of rows) map.set(Number(c.id), {
      first: String(c.first_name || '').trim(),
      last: String(c.last_name || '').trim(),
      phone: String(c.phone || '').trim(),
    });
    if (rows.length < 500) break;
  }
  return map;
}

async function run(mode, per, startPage) {
  const t0 = Date.now();
  const budgetMs = 22000;
  let custMap;
  try { custMap = await loadCustomerMap(); } catch (e) { return { ok: false, stage: 'load_customers', error: String(e.message || e) }; }

  let page = startPage, scanned = 0, updated = 0, skipped = 0, noCust = 0, errored = 0, done = false;
  while (Date.now() - t0 < budgetMs) {
    let jobs;
    try { jobs = await crud.searchPageN(crud.TABLES.jobs, {}, { id: 'desc' }, per, page); }
    catch (e) { return { ok: false, stage: 'load_jobs', page, error: String(e.message || e), scanned, updated }; }
    if (!jobs || !jobs.length) { done = true; break; }
    // Decide which jobs on this page actually need a write.
    const toUpdate = [];
    for (const j of jobs) {
      scanned++;
      const already = String(j.customer_first || '').trim();
      if (mode === 'sweep' && already) { skipped++; continue; }  // cron: only fill the blanks
      const c = custMap.get(Number(j.customer_id || 0));
      if (!c) { noCust++; continue; }
      if (String(j.customer_first || '') === c.first && String(j.customer_last || '') === c.last && String(j.customer_phone || '') === c.phone) { skipped++; continue; }
      toUpdate.push({ id: j.id, denorm: { customer_first: c.first, customer_last: c.last, customer_phone: c.phone } });
    }
    // Write them in concurrent batches of 8 (fast, but gentle on Xano).
    for (let k = 0; k < toUpdate.length; k += 8) {
      const batch = toUpdate.slice(k, k + 8);
      const res = await Promise.all(batch.map((u) => crud.update(crud.TABLES.jobs, u.id, u.denorm).then(() => true).catch(() => false)));
      updated += res.filter(Boolean).length;
      errored += res.filter((x) => !x).length;
      if (Date.now() - t0 > budgetMs) break;
    }
    page++;
    if (jobs.length < per) { done = true; break; }
  }
  return { ok: true, mode, customers_loaded: custMap.size, scanned, updated, skipped, noCust, errored, next_page: done ? null : page, done, elapsed_ms: Date.now() - t0 };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const action = String(q.action || 'backfill');
  if (action === 'addcols') { try { return json(200, await addCols()); } catch (e) { return json(200, { ok: false, error: String(e.message || e) }); } }

  // Read-only sanity check: confirm the loaders work + whether the denorm columns exist.
  if (action === 'probe') {
    try {
      const t0 = Date.now();
      const custMap = await loadCustomerMap();
      const jobs = await contentPage(crud.TABLES.jobs, 1, 5);
      const j0 = jobs[0] || {};
      return json(200, {
        ok: true,
        customers_loaded: custMap.size,
        first_job_ids: jobs.map((j) => j.id),
        denorm_columns_exist: Object.prototype.hasOwnProperty.call(j0, 'customer_first'),
        elapsed_ms: Date.now() - t0,
      });
    } catch (e) { return json(200, { ok: false, stage: 'probe', error: String(e.message || e) }); }
  }

  const mode = action === 'sweep' ? 'sweep' : 'all';
  const per = Math.min(200, Math.max(20, Number(q.per) || 120));
  const startPage = Math.max(1, Number(q.page) || 1);
  return json(200, await run(mode, per, startPage));
};
