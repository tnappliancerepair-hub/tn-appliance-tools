// pm-link — associate a job (and its customer) with a PM billing account so auto-charge on
// completion knows it's a PM job and which account to bill. Two ways:
//   - customer_id: add a customer record to the account's customer_ids (all their jobs match)
//   - job_id: tag that one job with pm_key (and pull its customer_id in too)
// Admin-gated. Small helper for the office / the property-management intake.
//
// POST { secret, pm_key, job_id?, customer_id? }
'use strict';
const { getPmAccount, upsertPmAccount } = require('./_lib/pm-accounts');
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
exports.config = { timeout: 20 };
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
const s = (v, n) => String(v == null ? '' : v).slice(0, n == null ? 60 : n).trim();

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'invalid_json' }); }
  if (s(b.secret, 80) !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const pmKey = s(b.pm_key);
  if (!pmKey) return json(400, { ok: false, error: 'pm_key required' });
  const acct = await getPmAccount(pmKey);
  if (!acct) return json(404, { ok: false, error: 'pm_account_not_found' });

  const ids = new Set((acct.customer_ids || []).map(String));
  let taggedJob = null;

  try {
    if (b.job_id) {
      const jobId = s(b.job_id, 20);
      // tag the job with pm_key + pull its customer into the account
      const r = await fetch(`${META}/table/7/content/${jobId}`, { method: 'PUT', headers: authH(), body: JSON.stringify({ pm_key: pmKey }) });
      taggedJob = r.ok ? jobId : ('tag_failed_' + r.status);
      // read the job to grab its customer id
      try {
        const jr = await fetch(`${META}/table/7/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ search: { id: parseInt(jobId, 10) }, per_page: 1 }) });
        const jrow = ((await jr.json()).items || [])[0];
        const cid = jrow && (jrow.bill_to_customer_id || jrow.customer_id);
        if (cid) ids.add(String(cid));
      } catch (_) {}
    }
    if (b.customer_id) ids.add(s(b.customer_id, 20));
    const saved = await upsertPmAccount(pmKey, { customer_ids: Array.from(ids) });
    return json(200, { ok: true, pm_key: pmKey, customer_ids: saved.customer_ids, tagged_job: taggedJob });
  } catch (err) { return json(500, { ok: false, error: err.message }); }
};
