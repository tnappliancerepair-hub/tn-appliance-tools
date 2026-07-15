// set-job-address — write a correct service address onto a job (admin-gated). Fills the
// gap that update_job_basics doesn't cover (it only does brand/model/appliance/problem).
// Only non-empty fields overwrite. Also refreshes the linked customer record's address so
// both agree. Used to fix/complete a job's address (Teddy 2026-07-15).
//
// POST { secret, job_id, address?, city?, state?, zip? }
'use strict';
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
exports.config = { timeout: 20 };
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
const s = (v, n) => String(v == null ? '' : v).slice(0, n == null ? 120 : n).trim();

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'invalid_json' }); }
  if (s(b.secret, 80) !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const jobId = parseInt(b.job_id, 10) || 0;
  if (!jobId) return json(400, { ok: false, error: 'job_id required' });

  const patch = {};
  if (s(b.address)) patch.service_address = s(b.address);
  if (s(b.city)) patch.service_city = s(b.city);
  if (s(b.state)) patch.service_state = s(b.state, 2).toUpperCase();
  if (s(b.zip)) patch.service_zip = s(b.zip, 5);
  if (!Object.keys(patch).length) return json(400, { ok: false, error: 'nothing to set' });

  try {
    // read the job (to find its customer) then patch it
    const jr = await fetch(`${META}/table/7/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ search: { id: jobId }, per_page: 1 }) });
    const job = ((await jr.json()).items || [])[0];
    if (!job) return json(404, { ok: false, error: 'job_not_found' });

    const r = await fetch(`${META}/table/7/content/${jobId}`, { method: 'PUT', headers: authH(), body: JSON.stringify(patch) });
    if (!r.ok) return json(200, { ok: false, error: 'job_write_' + r.status });

    // keep the customer record in sync (address/city/state/zip)
    const cid = job.bill_to_customer_id || job.customer_id;
    let custUpdated = false;
    if (cid) {
      const cpatch = {};
      if (patch.service_address) cpatch.address = patch.service_address;
      if (patch.service_city) cpatch.city = patch.service_city;
      if (patch.service_state) cpatch.state = patch.service_state;
      if (patch.service_zip) cpatch.zip = patch.service_zip;
      try { const cr = await fetch(`${META}/table/6/content/${cid}`, { method: 'PUT', headers: authH(), body: JSON.stringify(cpatch) }); custUpdated = cr.ok; } catch (_) {}
    }
    try { await fetch(`${META}/table/3/content`, { method: 'POST', headers: authH(), body: JSON.stringify({ action: 'job_address_set', metadata: { job_id: jobId, patch, customer_id: cid, at_ms: Date.now() } }) }); } catch (_) {}
    return json(200, { ok: true, job_id: jobId, set: patch, customer_updated: custUpdated });
  } catch (err) { return json(500, { ok: false, error: err.message }); }
};
