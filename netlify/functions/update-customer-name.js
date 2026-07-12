// update-customer-name — let the office fix a wrong customer NAME on a job's
// customer record. Danielle (2026-07-12) had a job showing "Pryor Pryor" (the
// parser doubled the last name) with no way to edit it — the Job File drawer let
// her fix the phone but not the name. This mirrors backfill-phones' proven
// customer-edit pattern: resolve the customer table by field-shape, then PUT a
// partial {first_name,last_name} (partial PUT preserves the row's other fields).
// Server-side metadata token, so no office password round-trip — the board is
// already gated, same trust model as office_quick_fill / move-attachment.
//
//   POST { job_id, first_name, last_name, actor? }  ->  { ok, customer_id, name }
'use strict';

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const EVENT_LOG = 3;

function authHeaders() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function j(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

// Resolve the customer table id by columns (first_name + last_name + phone, and
// NOT the conversation/customer_id shape of other tables). Cached per warm container.
let _cid = null;
async function customerTableId() {
  if (_cid) return _cid;
  for (const id of [5, 6, 1, 2, 8, 9, 10, 7, 14, 16]) {
    try {
      const r = await fetch(`${META}/table/${id}/content/search`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ per_page: 1, page: 1 }) });
      if (!r.ok) continue;
      const row = ((await r.json().catch(() => ({}))).items || [])[0];
      const keys = row ? Object.keys(row) : [];
      if (keys.includes('first_name') && keys.includes('last_name') && keys.includes('phone') && !keys.includes('conversation_id') && !keys.includes('customer_id')) { _cid = id; return id; }
    } catch (_) {}
  }
  throw new Error('could not resolve customer table id');
}

// Get the customer_id for a job via the function API (already returns customer).
async function customerIdForJob(jobId) {
  try {
    const r = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }), signal: AbortSignal.timeout(9000) });
    const d = await r.json().catch(() => ({}));
    const cand = (d && d.customer && (d.customer.id || d.customer.customer_id))
      || (d && d.job && d.job.customer_id) || (d && d.customer_id) || 0;
    return Number(cand) || 0;
  } catch (_) { return 0; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(200, { ok: true });
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'method_not_allowed' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return j(400, { ok: false, error: 'invalid_json' }); }
  const jobId = parseInt(b.job_id, 10);
  let customerId = parseInt(b.customer_id, 10) || 0;
  const actor = String(b.actor || 'office').slice(0, 40);
  if (!jobId && !customerId) return j(400, { ok: false, error: 'job_id or customer_id required' });

  // Any customer field the office needs to fix — Danielle 2026-07-12: "adjust ALL of
  // the customer's information because of errors, not just name + phone." Only the
  // fields actually PRESENT in the request are written (partial PUT preserves the rest).
  function norm(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 160); }
  function normPhone(v) {
    const d = String(v == null ? '' : v).replace(/[^\d+]/g, '');
    const digits = d.replace(/\D/g, '');
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits[0] === '1') return '+' + digits;
    return d;
  }
  const partial = {};
  if (b.first_name !== undefined) partial.first_name = norm(b.first_name, 80);
  if (b.last_name !== undefined) partial.last_name = norm(b.last_name, 80);
  if (b.phone !== undefined) partial.phone = normPhone(b.phone);
  if (b.email !== undefined) partial.email = norm(b.email, 160);
  if (b.address !== undefined) partial.address = norm(b.address, 200);
  if (b.city !== undefined) partial.city = norm(b.city, 80);
  if (b.state !== undefined) partial.state = norm(b.state, 40);
  if (b.zip !== undefined) partial.zip = norm(b.zip, 20);
  if (!Object.keys(partial).length) return j(400, { ok: false, error: 'no customer fields provided' });

  let h;
  try { h = authHeaders(); } catch (e) { return j(500, { ok: false, error: String(e.message || e) }); }

  if (!customerId && jobId) customerId = await customerIdForJob(jobId);
  if (!customerId) return j(404, { ok: false, error: 'could not resolve customer for this job' });

  let CUST;
  try { CUST = await customerTableId(); } catch (e) { return j(500, { ok: false, error: String(e.message || e) }); }

  // Partial PUT — write only the provided fields, preserve everything else on the row.
  try {
    const r = await fetch(`${META}/table/${CUST}/content/${customerId}`, { method: 'PUT', headers: h, body: JSON.stringify(partial) });
    if (!r.ok) { const t = await r.text().catch(() => ''); return j(200, { ok: false, error: 'customer PUT ' + r.status + ' ' + t.slice(0, 160) }); }
  } catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }

  // Audit — so danielle-activity / the log show who fixed it + which fields changed.
  try {
    await fetch(`${META}/table/${EVENT_LOG}/content`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ action: 'customer_info_edited', metadata: { job_id: jobId || null, customer_id: customerId, fields: partial, actor, at_ms: Date.now() } }),
    });
  } catch (_) {}

  return j(200, { ok: true, customer_id: customerId, updated: Object.keys(partial) });
};
