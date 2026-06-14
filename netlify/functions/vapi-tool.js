// vapi-tool — single proxy between Vapi server-tools and our Xano endpoints.
//
// WHY: Vapi POSTs tool calls wrapped in {message:{toolCalls:[{id,function:
// {name,arguments}}]}} and expects {results:[{toolCallId,result}]} back. Our
// Xano endpoints take FLAT params and return flat JSON, so pointing a Vapi tool
// straight at Xano fails ("Missing param"). This proxy unwraps the envelope,
// calls Xano with the right verb/params, and returns Vapi's format. Point every
// POST-ish Vapi tool's server URL at this function.

'use strict';

const XANO = (process.env.XANO_INTAKE_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA').replace(/\/+$/, '');
const NETLIFY = (process.env.NETLIFY_FUNCTIONS_BASE || 'https://tnapplianceexchange.net/.netlify/functions').replace(/\/+$/, '');

async function getJson(url) {
  const r = await fetch(url);
  try { return await r.json(); } catch (_) { return { error: `HTTP ${r.status}` }; }
}
async function postJson(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try { return await r.json(); } catch (_) { return { error: `HTTP ${r.status}` }; }
}

// Route a tool name + args to the right backend.
async function callBackend(name, a) {
  a = a || {};
  switch (name) {
    case 'lookup_customer_by_phone':
      return getJson(`${XANO}/lookup_customer_by_phone?phone=${encodeURIComponent(String(a.phone || '').trim())}`);
    case 'lookup_by_claim_number':
      return postJson(`${XANO}/lookup_by_claim_number`, { claim_or_dispatch_number: String(a.claim_or_dispatch_number || a.claim || a.number || '').trim() });
    case 'search_customers':
      return postJson(`${XANO}/search_customers`, { query: String(a.query || a.name || '').trim() });
    case 'voice_followup_send_links':
      return postJson(`${XANO}/voice_followup_send_links`, { job_id: Number(a.job_id || 0), offer_kind: String(a.offer_kind || 'portal_and_uploads') });
    case 'capture_callback':
      return postJson(`${NETLIFY}/capture-callback`, a);
    case 'check_service_zone':
      return getJson(`${XANO}/check_service_zone?zip_code=${encodeURIComponent(String(a.zip_code || a.zip || '').trim())}`);
    default:
      return { error: 'unknown tool: ' + name };
  }
}

// Extract [{id, name, args}] from whatever shape Vapi sends.
function parseToolCalls(body) {
  const m = (body && body.message) || body || {};
  if (Array.isArray(m.toolCallList)) {
    return m.toolCallList.map((tc) => ({ id: tc.id, name: tc.name || (tc.function && tc.function.name), args: tc.arguments || (tc.function && tc.function.arguments) }));
  }
  if (Array.isArray(m.toolCalls)) {
    return m.toolCalls.map((tc) => ({ id: tc.id, name: tc.function && tc.function.name, args: tc.function && tc.function.arguments }));
  }
  if (Array.isArray(body && body.toolCalls)) {
    return body.toolCalls.map((tc) => ({ id: tc.id, name: tc.function && tc.function.name, args: tc.function && tc.function.arguments }));
  }
  // flat fallback (someone POSTs args directly)
  return [{ id: (body && body.id) || 'call_1', name: body && body.name, args: (body && body.arguments) || body }];
}

function coerceArgs(args) {
  if (!args) return {};
  if (typeof args === 'string') { try { return JSON.parse(args); } catch (_) { return {}; } }
  return args;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let body; try { body = JSON.parse(event.body || '{}'); } catch (_) { body = {}; }

  const calls = parseToolCalls(body);
  const results = [];
  for (const c of calls) {
    let data;
    try { data = await callBackend(c.name, coerceArgs(c.args)); }
    catch (e) { data = { error: String((e && e.message) || e) }; }
    results.push({ toolCallId: c.id, result: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) };
};
