// add-service-zones — fills zip-coverage gaps in the service_zone table so
// check_service_zone (and the SquareTrade auto-assign) can route every zip to its
// area tech. Copies cluster/market/zone/state from a TEMPLATE zip already covered.
// Owner-gated, dryrun-first.
//   GET ?secret=<admin>&template_zip=70815&zips=70801,70805,...[&confirm=1]
'use strict';
const { getSecret } = require('./_lib/secrets');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function authH() { return { Authorization: 'Bearer ' + process.env.XANO_METADATA_TOKEN, 'Content-Type': 'application/json' }; }

// resolve the service_zone table id by field shape (zip_code + cluster)
let _tid = null;
async function zoneTableId() {
  if (_tid) return _tid;
  for (let id = 1; id <= 70; id++) {
    try {
      const r = await fetch(`${META}/table/${id}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ per_page: 1, page: 1 }) });
      if (!r.ok) continue;
      const row = ((await r.json()).items || [])[0];
      if (row && 'zip_code' in row && 'cluster' in row) { _tid = id; return id; }
    } catch (_) {}
  }
  return null;
}
async function findZip(tid, zip) {
  try { const r = await fetch(`${META}/table/${tid}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ search: { zip_code: zip }, per_page: 1, page: 1 }) }); if (!r.ok) return null; return ((await r.json()).items || [])[0] || null; } catch (_) { return null; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  if (!process.env.XANO_METADATA_TOKEN) return json(500, { ok: false, error: 'no metadata token' });

  const tmplZip = String(q.template_zip || '70815').trim();
  const zips = String(q.zips || '').split(',').map((z) => z.trim()).filter((z) => /^\d{5}$/.test(z));
  if (!zips.length) return json(400, { ok: false, error: 'pass &zips=comma,separated,5-digit' });

  const tid = await zoneTableId();
  if (!tid) return json(500, { ok: false, error: 'could not resolve service_zone table' });

  const tmpl = await findZip(tid, tmplZip);
  if (!tmpl) return json(400, { ok: false, error: 'template zip ' + tmplZip + ' has no service_zone row to copy' });
  const copy = { cluster: tmpl.cluster, market: tmpl.market, zone: tmpl.zone, state: tmpl.state, accept_new_jobs: tmpl.accept_new_jobs, notes: 'added via add-service-zones (gap fill)' };

  const plan = [];
  for (const z of zips) {
    const existing = await findZip(tid, z);
    plan.push({ zip: z, action: existing ? 'skip (already exists)' : 'add', will_set: existing ? null : { zip_code: z, ...copy } });
  }
  const toAdd = plan.filter((p) => p.action === 'add');

  if (q.confirm !== '1') return json(200, { ok: true, mode: 'dryrun', table: tid, template: { zip: tmplZip, cluster: tmpl.cluster, market: tmpl.market, state: tmpl.state }, would_add: toAdd.length, plan });

  let added = 0; const failed = [];
  for (const p of toAdd) {
    try {
      const r = await fetch(`${META}/table/${tid}/content`, { method: 'POST', headers: authH(), body: JSON.stringify({ zip_code: p.zip, ...copy }) });
      if (r.ok) added++; else failed.push({ zip: p.zip, status: r.status });
    } catch (e) { failed.push({ zip: p.zip, err: String(e.message || e) }); }
  }
  return json(200, { ok: true, mode: 'added', added, failed: failed.length, failed_list: failed.slice(0, 10) });
};
