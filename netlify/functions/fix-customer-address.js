// fix-customer-address — owner-gated manual correction of a customer's service address,
// for the handful of cash/legacy jobs with no dispatch to auto-recover from (e.g. a street
// that swallowed the city, or a customer who replies with their address). Writes the
// customer record, syncs the job's service_* fields, and logs the change. Read-back so the
// caller sees the result.
//
//   POST ?secret=<admin>  { customer_id, job_id?, address?, city?, state?, zip? }
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const CUSTOMER = crud.TABLES.customer; // 6
const JOBS = crud.TABLES.jobs;         // 7
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const p = Object.assign({}, q, body);
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (p.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const cid = Number(p.customer_id || 0);
  if (!cid) return json(400, { ok: false, error: 'customer_id required' });

  // Only write fields that were actually provided (never blank an existing good field).
  const custPatch = {};
  ['address', 'city', 'state', 'zip'].forEach((k) => { if (p[k] != null && String(p[k]).trim() !== '') custPatch[k] = String(p[k]).trim(); });
  if (!Object.keys(custPatch).length) return json(400, { ok: false, error: 'nothing to update' });

  let before = null;
  try { before = await crud.searchOne(CUSTOMER, { id: cid }); } catch (_) {}
  await crud.update(CUSTOMER, cid, custPatch);

  // Keep the job's denormalized service_* in sync so the board reflects it.
  if (p.job_id) {
    const jobPatch = {};
    if (custPatch.city) jobPatch.service_city = custPatch.city;
    if (custPatch.state) jobPatch.service_state = custPatch.state;
    if (custPatch.zip) jobPatch.service_zip = custPatch.zip;
    if (custPatch.address) jobPatch.service_address = custPatch.address;
    if (Object.keys(jobPatch).length) { try { await crud.update(JOBS, Number(p.job_id), jobPatch); } catch (_) {} }
  }

  await crud.logEvent('customer_address_manual_fix', { customer_id: cid, job_id: p.job_id || null, patch: custPatch, actor: p.actor || 'owner' });

  let after = null;
  try { after = await crud.searchOne(CUSTOMER, { id: cid }); } catch (_) {}
  const shape = (c) => c ? { address: c.address, city: c.city, state: c.state, zip: c.zip } : null;
  return json(200, { ok: true, customer_id: cid, applied: custPatch, before: shape(before), after: shape(after) });
};
