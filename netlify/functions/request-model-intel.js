// request-model-intel — ask the Mac daemon (MSA World / Whirlpool University) to
// pull recalls + tech bulletins + tech-sheets for a model. Emits MODEL_INTEL_
// REQUEST; the Mac agent caches the result to event_log; get-model-intel reads it.
// ant-troubleshoot fires this fire-and-forget to "warm" a model it hasn't seen.
//
//   POST { brand, model, appliance?, request_id? }  ->  { ok, request_id }

'use strict';
const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function s(v, m) { return String(v == null ? '' : v).slice(0, m || 200); }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const brand = s(b.brand, 40);
  const model = s(b.model, 60);
  if (!brand && !model) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'brand or model required' }) };
  const requestId = s(b.request_id, 80) || `mi_${(model || brand).replace(/\W/g, '')}_${Date.now()}`;

  try {
    const r = await fetch(`${XANO_BASE}/emit_colony_signal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signal_type: 'MODEL_INTEL_REQUEST', signal_strength: 60, source_colony: 'ant_troubleshoot', target_colonies: '',
        payload: JSON.stringify({ brand, model, appliance: s(b.appliance, 40), request_id: requestId }),
      }),
    });
    if (!r.ok) return { statusCode: 502, headers: CORS, body: JSON.stringify({ ok: false, error: 'emit_failed' }) };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, request_id: requestId }) };
};
