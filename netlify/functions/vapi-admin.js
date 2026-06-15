// vapi-admin — TEMPORARY remote admin so we can fix Ant Inbound's tools from the
// cloud (Teddy's on the road, the Vapi key lives in env/vault not on his laptop).
// Guarded by a shared secret. DELETE THIS FILE once the phone is wired.
//
//   GET/POST ?secret=<GUARD>&action=inspect   -> dump Ant Inbound model + tools
//   GET/POST ?secret=<GUARD>&action=apply     -> recreate 5 proxy tools + attach
//
// Uses getSecret('VAPI_PRIVATE_KEY') (env-first, then Xano vault).

'use strict';

const { getSecret } = require('./_lib/secrets');

const GUARD = 'tn-vapi-admin-9f83b1c4e7a206d5';
const VAPI = 'https://api.vapi.ai';
const PROXY = 'https://tnapplianceexchange.net/.netlify/functions/vapi-tool';
const INBOUND_NAME = 'Ant Inbound';

const TOOLS = [
  { name: 'lookup_customer_by_phone', description: 'Look up a caller by phone number. Returns customer + open jobs + caller_id_masked.', params: { phone: { type: 'string', description: 'Caller phone number.' } }, required: ['phone'] },
  { name: 'lookup_by_claim_number', description: 'Look up a job by claim, dispatch, or work-order number. Read back status, scheduled day, tech.', params: { claim_or_dispatch_number: { type: 'string', description: 'The number the caller gave.' } }, required: ['claim_or_dispatch_number'] },
  { name: 'search_customers', description: 'Find a caller by name or address when the number is masked/unmatched.', params: { query: { type: 'string', description: 'Full name or address.' } }, required: ['query'] },
  { name: 'voice_followup_send_links', description: 'Text the caller a self-service link (status / photo+video upload / reschedule). Needs the job_id from a lookup.', params: { job_id: { type: 'number', description: 'Job id from a prior lookup.' }, offer_kind: { type: 'string', description: 'portal_and_uploads | status | reschedule' } }, required: ['job_id'] },
  { name: 'capture_callback', description: 'Fallback when you cannot resolve the caller: take name + number + summary so the office calls back.', params: { name: { type: 'string' }, phone: { type: 'string' }, summary: { type: 'string' }, caller_type: { type: 'string' }, ref: { type: 'string' } }, required: ['name', 'phone', 'summary', 'caller_type'] },
];

function toolBody(t) {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: { type: 'object', properties: t.params, required: t.required } },
    server: { url: PROXY },
  };
}

async function vapi(method, path, key, body) {
  const r = await fetch(`${VAPI}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch (_) { json = { raw: text.slice(0, 300) }; }
  return { ok: r.ok, status: r.status, json };
}

function listFrom(resp) { const j = resp.json; return Array.isArray(j) ? j : (j.results || j.tools || j.assistants || []); }
function tname(t) { return (t && t.function && t.function.name) || (t && t.name) || ''; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.secret !== GUARD) return { statusCode: 403, body: 'forbidden' };

  const key = await getSecret('VAPI_PRIVATE_KEY');
  if (!key) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'VAPI_PRIVATE_KEY not in env or vault — cannot reach Vapi from here' }) };

  const action = q.action || 'inspect';

  // Phone-number routing: does the dialed number use an assistantId or a
  // server/assistant-request URL? This decides where the fix goes.
  if (action === 'phones') {
    const phones = listFrom(await vapi('GET', '/phone-number?limit=100', key));
    return { statusCode: 200, body: JSON.stringify(phones.map((p) => ({
      number: p.number, name: p.name,
      assistantId: p.assistantId || null,
      serverUrl: (p.server && p.server.url) || p.serverUrl || null,
      fallbackAssistantId: p.fallbackDestination && p.fallbackDestination.assistantId || null,
      squadId: p.squadId || null,
    })), null, 2) };
  }

  // Find Ant Inbound
  const aResp = await vapi('GET', '/assistant?limit=100', key);
  const inbound = listFrom(aResp).find((a) => (a.name || '').trim().toLowerCase() === INBOUND_NAME.toLowerCase());
  if (!inbound) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'Ant Inbound not found', names: listFrom(aResp).map((a) => a.name) }) };

  const full = await vapi('GET', `/assistant/${inbound.id}`, key);
  const model = (full.json && full.json.model) || {};
  const beforeIds = Array.isArray(model.toolIds) ? model.toolIds : [];

  // Map all tools by id for readability
  const allTools = listFrom(await vapi('GET', '/tool?limit=200', key));
  const byId = {}; allTools.forEach((t) => { byId[t.id] = { name: tname(t), url: (t.server && t.server.url) || '' }; });

  if (action === 'inspect') {
    return { statusCode: 200, body: JSON.stringify({
      ok: true,
      assistant: { id: inbound.id, model_provider: model.provider, model: model.model },
      attached: beforeIds.map((id) => ({ id, ...(byId[id] || { name: 'MISSING/deleted' }) })),
      all_tools_named: allTools.filter((t) => TOOLS.some((d) => d.name === tname(t))).map((t) => ({ id: t.id, name: tname(t), url: (t.server && t.server.url) || '' })),
    }, null, 2) };
  }

  if (action === 'apply') {
    // 1. detach
    await vapi('PATCH', `/assistant/${inbound.id}`, key, { model: Object.assign({}, model, { toolIds: [] }) });
    // 2. delete all existing copies of our 5 names, create fresh on proxy
    const created = [];
    for (const d of TOOLS) {
      for (const t of allTools.filter((x) => tname(x) === d.name)) {
        await vapi('DELETE', `/tool/${t.id}`, key);
      }
      const c = await vapi('POST', '/tool', key, toolBody(d));
      if (c.ok && c.json && c.json.id) created.push({ name: d.name, id: c.json.id });
      else created.push({ name: d.name, error: c.status, detail: c.json });
    }
    const newIds = created.filter((c) => c.id).map((c) => c.id);
    // 3. attach
    const attachResp = await vapi('PATCH', `/assistant/${inbound.id}`, key, { model: Object.assign({}, model, { toolIds: newIds }) });
    // 4. read back
    const verify = await vapi('GET', `/assistant/${inbound.id}`, key);
    const vIds = (verify.json && verify.json.model && verify.json.model.toolIds) || [];
    return { statusCode: 200, body: JSON.stringify({
      ok: true,
      created,
      attach_status: attachResp.status,
      verify_attached_ids: vIds,
      verify_matches: JSON.stringify(vIds.slice().sort()) === JSON.stringify(newIds.slice().sort()),
    }, null, 2) };
  }

  return { statusCode: 400, body: 'unknown action' };
};
