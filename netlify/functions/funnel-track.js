// funnel-track — lightweight web conversion-funnel logger. The $50 Quick Check
// page pings this at each step so we can see exactly where visitors drop off,
// without depending on GA. Public, fire-and-forget. No PII beyond appliance.
//   POST { step, conv_id, appliance, payer, page }
'use strict';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
const STEPS = new Set(['open', 'started', 'reached_pay', 'paid']);
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const step = String(b.step || '').trim();
  if (!STEPS.has(step)) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'bad step' }) };
  try {
    await fetch(`${XANO}/record_event_log`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'web_funnel', metadata_json: JSON.stringify({ step, conv_id: String(b.conv_id || ''), appliance: String(b.appliance || '').slice(0, 40), payer: String(b.payer || '').slice(0, 20), page: String(b.page || 'quick_check').slice(0, 40), at_ms: Date.now() }) }),
      signal: AbortSignal.timeout(6000),
    });
  } catch (_) {}
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
};
