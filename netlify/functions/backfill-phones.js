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
const crud = require('./_lib/xano/metadata-crud');
const CUST = crud.TABLES.customer; // 6
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

  // 2) Ant customers missing a phone — paginate at 500 (metadata API caps per_page,
  // 3000 returns 400). Walk pages until a short page comes back.
  let custs = [];
  try {
    for (let pg = 1; pg <= 30; pg++) {
      const rows = await crud.searchPageN(CUST, {}, { id: 'desc' }, 500, pg);
      if (!rows || !rows.length) break;
      custs = custs.concat(rows);
      if (rows.length < 500) break;
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
    if (!dry) { try { await crud.update(CUST, c.id, { phone }); } catch (_) {} }
    filled.push({ id: c.id, name: ((c.first_name || '') + ' ' + (c.last_name || '')).trim(), phone });
  }
  if (!dry && filled.length) { try { await crud.logEvent('phones_backfilled', { count: filled.length, at_ms: Date.now() }); } catch (_) {} }

  return j(200, {
    ok: true, mode: dry ? 'dryrun' : 'live',
    hcp_customers_scanned: hcpRows, hcp_unique_names: namePhones.size,
    ant_customers: custs.length, ant_missing_phone: missing.length,
    matched_unique: filled.length, ambiguous_skipped: ambiguous, no_match: nomatch,
    note: dry ? 'DRY RUN — nothing written. Add &confirm=1 to fill these.' : 'wrote ' + filled.length + ' phones',
    sample: filled.slice(0, 20),
  });
};
