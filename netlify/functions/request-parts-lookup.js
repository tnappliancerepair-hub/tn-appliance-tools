// request-parts-lookup — Teddy Tool (or the cash Quick Check) asks the Mac-local
// parts daemon to find the OEM (Marcone) + aftermarket (Amazon) part for a job's
// model + failed component. Emits a PARTS_LOOKUP_REQUEST colony signal that the
// Mac agent (parts_lookup_request.js) consumes; result lands in event_log and is
// read back via get-parts-lookup.js.
//
//   POST { job_id, model, serial?, appliance?, brand?, component? }
//   -> { ok, request_id }   (poll get-parts-lookup?request_id=... for the result)

'use strict';

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function s(v, m) { return String(v == null ? '' : v).slice(0, m || 200); }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(String(b.job_id || '').replace(/\D/g, ''), 10) || 0;
  const model = s(b.model, 60);
  const serial = s(b.serial, 60);
  if (!jobId && !model && !serial) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'job_id + model (or serial) required' }) };
  }

  const requestId = `pl_${jobId || 'x'}_${Date.now()}`;
  const payload = {
    job_id: jobId || null,
    request_id: requestId,
    model,
    serial,
    appliance: s(b.appliance, 40),
    brand: s(b.brand, 40),
    component: s(b.component || b.failure_description, 120),
  };

  try {
    const r = await fetch(`${XANO_BASE}/emit_colony_signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signal_type: 'PARTS_LOOKUP_REQUEST',
        signal_strength: 70,
        source_colony: 'teddy_tool',
        target_colonies: '',
        payload: JSON.stringify(payload),
      }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ ok: false, error: 'emit_failed', detail: txt.slice(0, 200) }) };
    }
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, request_id: requestId }) };
};
