// relabel-warranty-dups — fixes the mislabeled jobs: self_pay jobs whose customer
// ALSO has a real warranty job are duplicates created when a warranty customer
// followed our intake "get more info" link into the website (which defaults to
// self_pay). This relabels them customer_type=warranty and copies the warranty
// company + claim # from the customer's real warranty job.
//
// Writes via update_job_full_info (XS db.edit — bypasses the metadata enum-drop
// footgun). Owner-gated. DRY-RUN by default; &confirm=1 performs the relabel.
//
//   GET ?secret=<admin>&dryrun=1            list candidates (default)
//   GET ?secret=<admin>&confirm=1           relabel them
//   GET ...&source=web_chat                 only relabel web_chat-sourced dupes
//   GET ...&max=400                         cap jobs scanned (default 600)
'use strict';
const { getSecret } = require('./_lib/secrets');
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function authH() { const t = process.env.XANO_METADATA_TOKEN; return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }

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
  const body = { per_page: perPage || 100, page: page || 1 };
  if (filter) body.search = filter; if (sort) body.sort = sort;
  const r = await fetch(`${META}/table/${tableId}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify(body) });
  if (!r.ok) return [];
  return ((await r.json()).items) || [];
}
function isWarranty(j) { return String(j.customer_type || '').toLowerCase() === 'warranty' || String(j.warranty_company || '').trim() || String(j.claim_number || '').trim(); }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  if (!process.env.XANO_METADATA_TOKEN) return json(500, { ok: false, error: 'no metadata token' });
  const confirm = q.confirm === '1';
  const onlyWebChat = String(q.source || '') === 'web_chat';
  const max = Math.min(parseInt(q.max, 10) || 600, 2000);
  const pw = (await getSecret('OFFICE_PASSWORD')) || 'antlives';

  const ids = await resolveIds();
  if (!ids.jobs) return json(200, { ok: false, error: 'could not resolve jobs table' });

  // 1) pull self_pay jobs (paginate)
  let selfPay = [];
  for (let page = 1; page <= 10 && selfPay.length < max; page++) {
    const batch = await search(ids.jobs, { customer_type: 'self_pay' }, { id: 'desc' }, 200, page);
    if (!batch.length) break;
    selfPay = selfPay.concat(batch);
  }
  selfPay = selfPay.slice(0, max);

  // 2) for each unique customer, find their warranty job (company + claim to copy)
  const custIds = [...new Set(selfPay.map((j) => j.customer_id).filter(Boolean))];
  const warrantyOf = new Map(); // cust_id -> {company, claim}
  await Promise.all(custIds.map(async (cid) => {
    try {
      const theirs = await search(ids.jobs, { customer_id: cid }, { id: 'desc' }, 30, 1);
      const w = theirs.find(isWarranty);
      if (w) warrantyOf.set(cid, { company: String(w.warranty_company || '').trim(), claim: String(w.claim_number || '').trim(), from_job: w.id });
    } catch (_) {}
  }));

  // 3) candidate self_pay jobs whose customer is a warranty customer
  const candidates = selfPay.filter((j) => j.customer_id && warrantyOf.has(j.customer_id) && !isWarranty(j))
    .filter((j) => !onlyWebChat || String(j.source_type || '') === 'web_chat')
    .map((j) => { const w = warrantyOf.get(j.customer_id); return { job_id: j.id, customer_id: j.customer_id, source: j.source_type || '', status: j.current_status || '', apply_company: w.company, apply_claim: w.claim, from_warranty_job: w.from_job }; });

  if (!confirm) {
    return json(200, { ok: true, mode: 'dryrun', scanned_self_pay: selfPay.length, would_relabel: candidates.length, sample: candidates.slice(0, 25), note: 'add &confirm=1 to relabel' });
  }

  // 4) relabel each via update_job_full_info (writes customer_type + warranty fields)
  let done = 0; const failed = [];
  for (const c of candidates) {
    try {
      const r = await fetch(`${XANO}/update_job_full_info`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: c.job_id, office_password: pw, customer_type: 'warranty', warranty_company: c.apply_company || undefined, claim_number: c.apply_claim || undefined }),
        signal: AbortSignal.timeout(12000),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d && d.success !== false) done++; else failed.push({ job_id: c.job_id, err: (d && d.error) || r.status });
    } catch (e) { failed.push({ job_id: c.job_id, err: String(e.message || e) }); }
  }
  return json(200, { ok: true, mode: 'relabeled', relabeled: done, failed: failed.length, failed_list: failed.slice(0, 10), total_candidates: candidates.length });
};
