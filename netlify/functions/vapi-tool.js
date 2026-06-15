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

// Tools that are GET on Xano (everything else is POST with the unwrapped args).
// Verified against the .xs endpoint method suffixes; everything else is POST.
const GET_TOOLS = new Set(['lookup_customer_by_phone', 'check_service_zone', 'get_parts_status', 'get_job_arrival_status']);
// Tool name -> Xano endpoint path when they differ.
const ENDPOINT_OVERRIDE = { start_new_intake: 'create_job_from_chat' };
// Tools that live on Netlify, not Xano.
const NETLIFY_TOOLS = { capture_callback: 'capture-callback' };

function qs(a) {
  const parts = Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

// Route a tool name + args to the right backend. Generic by default: unwrap the
// Vapi envelope and call Xano flat (POST), so EVERY tool the assistant has works
// without per-tool code. GET tools use query params; a couple have overrides.
async function callBackend(name, a) {
  a = a || {};
  if (!name) return { error: 'no tool name' };
  if (NETLIFY_TOOLS[name]) return postJson(`${NETLIFY}/${NETLIFY_TOOLS[name]}`, a);
  const path = ENDPOINT_OVERRIDE[name] || name;
  if (GET_TOOLS.has(name)) return getJson(`${XANO}/${path}${qs(a)}`);
  return postJson(`${XANO}/${path}`, a);
}

// Shape sensitive read results down to what the assistant needs — and strip
// internal diagnosis notes so they never enter the LLM context (Teddy's rule:
// Ant never tells the customer what's wrong / part numbers).
function stripInternal(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripInternal);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'notes_internal' || k === 'problem_description' || k === 'problem_summary' || k === 'notes') continue;
    out[k] = (v && typeof v === 'object') ? stripInternal(v) : v;
  }
  return out;
}

function shapeResult(name, data) {
  if (!data || typeof data !== 'object') return data;
  if (name === 'lookup_by_claim_number') {
    return { found: (data.match_count || 0) > 0, match_count: data.match_count || 0, primary: data.primary || null };
  }
  if (name === 'lookup_customer_by_phone') {
    const c = data.customer || {};
    return {
      found: !!data.found,
      caller_id_masked: !!data.caller_id_masked,
      hint: data.hint || '',
      customer_first_name: c.first_name || '',
      open_jobs: Array.isArray(data.open_jobs) ? data.open_jobs.map(stripInternal) : [],
      last_call_summary: data.last_call_summary || '',
    };
  }
  if (name === 'search_customers') {
    return { match_count: data.match_count || (Array.isArray(data.matches) ? data.matches.length : 0), matches: stripInternal(data.matches || data.results || []) };
  }
  return stripInternal(data);
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

// Fire-and-forget visibility: log every proxy call + whether it found anything,
// with the outcome baked into the action name so get_event_log_by_action can
// read it (that endpoint returns only action+last_at, not metadata).
async function logProxy(name, args, data) {
  const tok = process.env.XANO_METADATA_TOKEN;
  if (!tok) return;
  let found = false;
  if (data && typeof data === 'object') {
    if (typeof data.match_count === 'number') found = data.match_count > 0;
    else if (typeof data.found === 'boolean') found = data.found;
    else if (data.primary || (Array.isArray(data.results) && data.results.length)) found = true;
    else if (data.success === true && !data.error) found = true;
  }
  const action = `vapi_proxy_${name}_${found ? 'found' : 'empty'}`;
  try {
    await fetch('https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table/3/content', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, metadata: { name, args, found, at_ms: Date.now() } }),
    });
  } catch (_) {}
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let body; try { body = JSON.parse(event.body || '{}'); } catch (_) { body = {}; }

  const calls = parseToolCalls(body);
  const results = [];
  for (const c of calls) {
    const a = coerceArgs(c.args);
    let data;
    try { data = await callBackend(c.name, a); }
    catch (e) { data = { error: String((e && e.message) || e) }; }
    await logProxy(c.name || 'unknown', a, data);
    const shaped = shapeResult(c.name, data);
    results.push({ toolCallId: c.id, result: typeof shaped === 'string' ? shaped : JSON.stringify(shaped) });
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) };
};
