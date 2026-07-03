// notify-part-ordered — fire the "we ordered your part, ETA is X, what's your
// availability?" text for ONE job, on demand. The office-board drawer's parts
// order goes through record_parts_order (XS), which sets the ETA but can't call
// our guarded SMS path — so the drawer calls this right after ordering so the
// customer gets the same immediate text the To-Order queue sends. Idempotent
// (part-notify dedupes one text per job). (Teddy 2026-07-03)
'use strict';

const { notifyPartOrdered } = require('./_lib/part-notify');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ ok: false, error: 'method_not_allowed' }) };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const job_id = parseInt(b.job_id, 10) || 0;
  if (!job_id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'job_id required' }) };
  let r = null;
  try { r = await notifyPartOrdered({ job_id, eta_date: String(b.eta_date || '') }); }
  catch (e) { r = { ok: false, reason: String((e && e.message) || e) }; }
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: !!(r && r.ok), reason: r && r.reason }) };
};
