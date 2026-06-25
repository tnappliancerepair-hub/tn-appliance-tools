// relabel-warranty-dups-background — the FULL sweep. Netlify background functions
// get ~15 min, so this can page through the entire self_pay set, find every job
// whose customer also has a warranty job, and relabel it customer_type=warranty
// (+ copy company/claim when unambiguous). Logs a summary to event_log when done.
//
// Fire: GET /.netlify/functions/relabel-warranty-dups-background?secret=<admin>
// (returns 202 immediately; check results via event_log action=relabel_warranty_sweep)
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function authH() { return { Authorization: 'Bearer ' + process.env.XANO_METADATA_TOKEN, 'Content-Type': 'application/json' }; }

let _ids = null;
async function resolveIds() {
  if (_ids) return _ids;
  const cands = [5, 6, 1, 2, 8, 9, 10, 7, 14, 16, 3, 4];
  let customer = null, jobs = null;
  for (const id of cands) {
    if (customer && jobs) break;
    let row;
    try { const r = await fetch(`${META}/table/${id}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ per_page: 1, page: 1 }) }); if (!r.ok) continue; row = ((await r.json()).items || [])[0]; } catch (_) { continue; }
    if (!row) continue;
    const k = Object.keys(row);
    if (!customer && k.includes('first_name') && k.includes('last_name') && k.includes('phone') && !k.includes('customer_id')) customer = id;
    if (!jobs && k.includes('customer_id') && (k.includes('scheduling_status') || k.includes('customer_type'))) jobs = id;
  }
  _ids = { customer, jobs };
  return _ids;
}
async function search(tableId, filter, sort, perPage, page) {
  const r = await fetch(`${META}/table/${tableId}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ per_page: perPage || 100, page: page || 1, search: filter, sort }) });
  if (!r.ok) return [];
  return ((await r.json()).items) || [];
}
const isWar = (j) => String(j.customer_type || '').toLowerCase() === 'warranty' || String(j.warranty_company || '').trim() || String(j.claim_number || '').trim();

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };
  const pw = (await getSecret('OFFICE_PASSWORD')) || 'antlives';
  const ids = await resolveIds();
  if (!ids.jobs) { return { statusCode: 200, body: 'no jobs table' }; }

  // 1) all self_pay jobs (paginate to a sane ceiling)
  let selfPay = [];
  for (let page = 1; page <= 25; page++) {
    const batch = await search(ids.jobs, { customer_type: 'self_pay' }, { id: 'desc' }, 100, page);
    if (!batch.length) break;
    selfPay = selfPay.concat(batch);
    if (selfPay.length >= 2500) break;
  }

  // 2) warranty lookup per unique customer (chunked)
  const custIds = [...new Set(selfPay.map((j) => j.customer_id).filter(Boolean))];
  const warOf = new Map();
  for (let i = 0; i < custIds.length; i += 10) {
    await Promise.all(custIds.slice(i, i + 10).map(async (cid) => {
      try {
        const theirs = await search(ids.jobs, { customer_id: cid }, { id: 'desc' }, 20, 1);
        const wj = theirs.filter(isWar);
        if (wj.length) {
          const claims = [...new Set(wj.map((x) => String(x.claim_number || '').trim()).filter(Boolean))];
          const w = wj.find((x) => String(x.claim_number || '').trim()) || wj[0];
          warOf.set(cid, { company: String(w.warranty_company || '').trim(), claim: claims.length === 1 ? claims[0] : '' });
        }
      } catch (_) {}
    }));
  }

  // 3) relabel every self_pay job whose customer is a warranty customer (chunked)
  const cands = selfPay.filter((j) => j.customer_id && warOf.has(j.customer_id) && !isWar(j));
  let done = 0, failed = 0;
  for (let i = 0; i < cands.length; i += 6) {
    await Promise.all(cands.slice(i, i + 6).map(async (j) => {
      const w = warOf.get(j.customer_id);
      try {
        const r = await fetch(`${XANO}/update_job_full_info`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: j.id, office_password: pw, customer_type: 'warranty', warranty_company: w.company || undefined, claim_number: w.claim || undefined }), signal: AbortSignal.timeout(9000) });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d && d.success !== false) done++; else failed++;
      } catch (_) { failed++; }
    }));
  }

  try { await crud.logEvent('relabel_warranty_sweep', { scanned_self_pay: selfPay.length, candidates: cands.length, relabeled: done, failed, at_ms: Date.now() }); } catch (_) {}
  return { statusCode: 200, body: JSON.stringify({ scanned: selfPay.length, candidates: cands.length, relabeled: done, failed }) };
};
