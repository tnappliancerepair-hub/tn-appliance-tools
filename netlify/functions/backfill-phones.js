// backfill-phones — fill in MISSING customer phone numbers on our Ant customer
// records from the HCP archive (Supabase hcp_archive, kind='customer'), so the
// caller-ID greeting works (Ant matches an incoming call -> the customer -> their
// open jobs). Warranty intakes often land with name+address but no phone; this
// recovers the number from the HCP history where we have it.
//
// SAFE BY DESIGN: only fills when there's a UNIQUE name match (exactly one phone
// for that name in the archive). Ambiguous names (2+ different phones) are skipped,
// never guessed — a wrong phone would text/call the wrong person.
//
//   GET ?secret=<admin>                 DRY RUN — show what it WOULD fill, write nothing
//   GET ?secret=<admin>&confirm=1       LIVE — write the matches (capped &max=, default 200)
'use strict';
const { getSecret } = require('./_lib/secrets');
const sb = require('./_lib/supabase');

// Talk to the Xano Metadata API directly (same proven shape as cash-leads):
// resolve the customer table by FIELD SHAPE (ids conflict across the repo) and
// ALWAYS omit the `search` key — the content/search endpoint 400s on search:{}.
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
function authHeaders() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const p10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
function phoneOf(d) {
  if (!d) return '';
  const cands = [];
  if (Array.isArray(d.phone_numbers)) for (const pn of d.phone_numbers) cands.push(pn && (pn.number || pn.phone || pn));
  cands.push(d.mobile_number, d.home_number, d.work_number, d.phone, d.phone_number);
  for (const c of cands) { const t = p10(c); if (t.length === 10) return t; }
  return '';
}

// Resolve the customer table id by columns (first_name+last_name+phone, and NOT
// the conversation/customer_id shape of other tables). Cached per warm container.
let _custId = null;
async function resolveCustomerTable() {
  if (_custId) return _custId;
  const candidates = [6, 5, 1, 2, 8, 9, 10, 7, 14, 16, 3, 4];
  for (const id of candidates) {
    let row;
    try {
      const r = await fetch(`${META}/table/${id}/content/search`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ per_page: 1, page: 1 }),
      });
      if (!r.ok) continue;
      const jj = await r.json().catch(() => ({}));
      row = (jj.items || [])[0];
    } catch (_) { continue; }
    if (!row) continue;
    const keys = Object.keys(row);
    const looksCustomer = keys.includes('first_name') && keys.includes('last_name') && keys.includes('phone') && !keys.includes('conversation_id') && !keys.includes('customer_id');
    if (looksCustomer) { _custId = id; return id; }
  }
  throw new Error('could not resolve customer table by field shape');
}

// One page of a table, search key OMITTED (all rows). 400-safe.
async function listPage(tableId, perPage, page, sort) {
  const body = { per_page: perPage, page: page || 1 };
  if (sort) body.sort = sort;
  const r = await fetch(`${META}/table/${tableId}/content/search`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`list table ${tableId} p${page} -> ${r.status} ${t.slice(0, 120)}`); }
  const jj = await r.json().catch(() => ({}));
  return (jj && jj.items) || [];
}
async function updateRow(tableId, rowId, partial) {
  const r = await fetch(`${META}/table/${tableId}/content/${rowId}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(partial),
  });
  return r.ok;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return j(401, { ok: false, error: 'unauthorized' });
  if (!(await sb.isConnected())) return j(200, { ok: false, error: 'supabase not configured' });
  const dry = q.confirm !== '1';
  const MAX = Math.min(500, parseInt(q.max, 10) || 200);

  // 1) HCP archive: normalized name -> set of distinct phones
  const namePhones = new Map();
  let offset = 0; const page = 1000; let hcpRows = 0;
  while (offset < 20000) {
    let rows;
    try { rows = await sb.select('hcp_archive', { kind: 'eq.customer', select: 'data', limit: String(page), offset: String(offset) }); }
    catch (e) { return j(200, { ok: false, error: 'supabase select: ' + String(e.message || e) }); }
    if (!rows || !rows.length) break;
    hcpRows += rows.length;
    for (const r of rows) {
      const d = r.data || {};
      const nm = norm((d.first_name || '') + (d.last_name || ''));
      const ph = phoneOf(d);
      if (nm && ph) { if (!namePhones.has(nm)) namePhones.set(nm, new Set()); namePhones.get(nm).add(ph); }
    }
    if (rows.length < page) break;
    offset += page;
  }

  // 2) Ant customers missing a phone — resolve the table by shape, then page at
  //    200/page (search key omitted) until a short page comes back.
  let CUST;
  try { CUST = await resolveCustomerTable(); }
  catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }
  let custs = [];
  try {
    for (let pg = 1; pg <= 60; pg++) {
      const rows = await listPage(CUST, 200, pg, { id: 'desc' });
      if (!rows || !rows.length) break;
      custs = custs.concat(rows);
      if (rows.length < 200) break;
    }
  } catch (e) { return j(200, { ok: false, error: 'xano customers: ' + String(e.message || e) }); }
  const missing = custs.filter((c) => p10(c.phone).length !== 10);

  const filled = []; let ambiguous = 0, nomatch = 0;
  for (const c of missing) {
    if (filled.length >= MAX) break;
    const nm = norm((c.first_name || '') + (c.last_name || ''));
    const set = nm && namePhones.get(nm);
    if (!set) { nomatch++; continue; }
    if (set.size !== 1) { ambiguous++; continue; }
    const phone = [...set][0];
    if (!dry) { try { await updateRow(CUST, c.id, { phone }); } catch (_) {} }
    filled.push({ id: c.id, name: ((c.first_name || '') + ' ' + (c.last_name || '')).trim(), phone });
  }

  return j(200, {
    ok: true, mode: dry ? 'dryrun' : 'live', customer_table: CUST,
    hcp_customers_scanned: hcpRows, hcp_unique_names: namePhones.size,
    ant_customers: custs.length, ant_missing_phone: missing.length,
    matched_unique: filled.length, ambiguous_skipped: ambiguous, no_match: nomatch,
    note: dry ? 'DRY RUN — nothing written. Add &confirm=1 to fill these.' : 'wrote ' + filled.length + ' phones',
    sample: filled.slice(0, 20),
  });
};
