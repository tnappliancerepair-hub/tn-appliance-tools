// vapi-admin — remote admin for Ant Inbound so Vapi changes are a one-command
// push from anywhere (no dashboard fights, key lives in env/vault not a laptop).
//
//   GET/POST ?secret=<GUARD>&action=<inspect|fix|voice|voiceon|prompt|setprompt|
//            phones|lastcall|env|apply>
//
// SECURITY: the access guard is read from the vault secret VAPI_ADMIN_SECRET
// (env-first, then Xano app_config), falling back to the legacy constant only
// until that secret is set. To lock it down: add VAPI_ADMIN_SECRET in
// admin-secrets.html, then this file's fallback can be removed.
// Uses getSecret('VAPI_PRIVATE_KEY') for the Vapi key (same vault path).

'use strict';

const { getSecret } = require('./_lib/secrets');

// Legacy fallback — used ONLY if the VAPI_ADMIN_SECRET vault secret is unset.
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const VAPI = 'https://api.vapi.ai';
const PROXY = 'https://tnapplianceexchange.net/.netlify/functions/vapi-tool';
const INBOUND_NAME = 'Ant Inbound';

const TOOLS = [
  { name: 'lookup_customer_by_phone', description: 'Look up a caller by phone number. Returns customer + open jobs + caller_id_masked.', params: { phone: { type: 'string', description: 'Caller phone number.' } }, required: ['phone'] },
  { name: 'lookup_by_claim_number', description: 'Look up a job by claim, dispatch, or work-order number. Read back status, scheduled day, tech.', params: { claim_or_dispatch_number: { type: 'string', description: 'The number the caller gave.' } }, required: ['claim_or_dispatch_number'] },
  { name: 'search_customers', description: 'Find a caller by name or address when the number is masked/unmatched.', params: { query: { type: 'string', description: 'Full name or address.' } }, required: ['query'] },
  { name: 'voice_followup_send_links', description: 'Text the caller a self-service link (status / photo+video upload / reschedule). Needs the job_id from a lookup.', params: { job_id: { type: 'number', description: 'Job id from a prior lookup.' }, offer_kind: { type: 'string', description: 'portal_and_uploads | status | reschedule' } }, required: ['job_id'] },
  { name: 'capture_callback', description: 'Fallback when you cannot resolve the caller: take name + number + summary so the office calls back.', params: { name: { type: 'string' }, phone: { type: 'string' }, summary: { type: 'string' }, caller_type: { type: 'string' }, ref: { type: 'string' } }, required: ['name', 'phone', 'summary', 'caller_type'] },
  { name: 'message_for_tech', description: 'When a caller wants to reach their technician directly, DO NOT transfer to the tech. Offer to drop the tech a quick message — he gets an alert on his app and can read it. Verify the caller first so you have their job_id.', params: { job_id: { type: 'number', description: 'from a prior lookup' }, message: { type: 'string', description: 'what the customer wants to tell their tech' }, customer_name: { type: 'string' }, phone: { type: 'string' } }, required: ['message'] },
  { name: 'create_job_from_call', description: 'Create a NEW job/ticket from this call and put it in the office Needs-Scheduled queue. USE THIS for a CALLBACK when a prior repair did not hold (caller says the tech came out but it is still not working), or for a brand-new request. ALWAYS verify who the caller is first (phone/claim/name).', params: { customer_first_name: { type: 'string' }, customer_last_name: { type: 'string' }, customer_phone: { type: 'string' }, customer_zip: { type: 'string' }, appliance_type: { type: 'string', description: 'fridge, washer, dryer, oven, etc.' }, appliance_brand: { type: 'string' }, problem_summary: { type: 'string', description: 'For a callback, START with "CALLBACK:" and note what is still wrong + the original claim or work-order number.' }, customer_type: { type: 'string', description: 'warranty or self_pay' }, warranty_company: { type: 'string' } }, required: ['customer_first_name', 'customer_phone', 'appliance_type', 'problem_summary'] },
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
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return { statusCode: 403, body: 'forbidden' };

  const key = await getSecret('VAPI_PRIVATE_KEY');
  if (!key) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'VAPI_PRIVATE_KEY not in env or vault — cannot reach Vapi from here' }) };

  const action = q.action || 'inspect';

  if (action === 'env') {
    return { statusCode: 200, body: JSON.stringify({
      ok: true,
      has_metadata_token: !!process.env.XANO_METADATA_TOKEN,
      has_vapi_key_env: !!process.env.VAPI_PRIVATE_KEY,
    }) };
  }

  // Scoreboard of recent calls — each call's endedReason, caller, direction,
  // duration. Read-only. ?action=calls&limit=30 (also &reason=<substr> to filter
  // by endedReason, e.g. silence/transfer/error). For "how did we do today."
  if (action === 'calls') {
    const n = Math.min(Number(q.limit || 30), 100);
    const raw = listFrom(await vapi('GET', `/call?limit=${n}`, key));
    let rows = raw.map((c) => {
      const started = c.startedAt || c.createdAt || '';
      const ended = c.endedAt || '';
      let dur = '';
      if (started && ended) { try { dur = Math.round((new Date(ended) - new Date(started)) / 1000) + 's'; } catch (_) {} }
      return {
        started,
        dur,
        dir: (c.type || '').replace('PhoneCall', ''),
        from: (c.customer && c.customer.number) || (c.phoneNumber && c.phoneNumber.number) || '',
        ended_reason: c.endedReason || c.status || '',
      };
    });
    if (q.reason) rows = rows.filter((r) => String(r.ended_reason).toLowerCase().includes(String(q.reason).toLowerCase()));
    // tally endedReasons so the scoreboard is readable at a glance
    const tally = {};
    for (const r of rows) tally[r.ended_reason] = (tally[r.ended_reason] || 0) + 1;
    return { statusCode: 200, body: JSON.stringify({ ok: true, count: rows.length, tally, calls: rows }, null, 2) };
  }

  // Dump the most recent call's tool activity (name, server URL, args, result/error).
  if (action === 'lastcall') {
    const calls = listFrom(await vapi('GET', '/call?limit=5', key));
    const c = calls[0];
    if (!c) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no calls' }) };
    const detail = await vapi('GET', `/call/${c.id}`, key);
    const cj = detail.json || {};
    const msgs = (cj.messages || cj.artifact && cj.artifact.messages || []);
    const toolEvents = [];
    for (const m of msgs) {
      if (m.role === 'tool_calls' || m.toolCalls) {
        (m.toolCalls || []).forEach((tc) => toolEvents.push({ kind: 'call', name: tc.function && tc.function.name, args: tc.function && tc.function.arguments }));
      }
      if (m.role === 'tool_call_result' || m.role === 'tool') {
        toolEvents.push({ kind: 'result', name: m.name, result: String(m.result || m.content || '').slice(0, 300) });
      }
    }
    // raw=1: dump the full tool-related message objects + any Vapi server logs,
    // so we can see EXACTLY what Vapi sent our proxy and what it got back.
    if (q.raw === '1') {
      const rawTool = msgs.filter((m) => /tool/i.test(m.role || '') || m.toolCalls || m.toolCallId);
      const logs = await vapi('GET', `/logs?callId=${c.id}&limit=50`, key);
      const logRows = listFrom(logs);
      const serverEvents = logRows
        .filter((l) => /tool|server|request/i.test(JSON.stringify(l).slice(0, 200)))
        .map((l) => ({ type: l.type, requestUrl: l.requestUrl || (l.request && l.request.url), responseStatus: l.responseHttpStatus || (l.response && l.response.status), error: l.error, body: typeof l.requestBody === 'object' ? l.requestBody : undefined }));
      return { statusCode: 200, body: JSON.stringify({
        ok: true, call_id: c.id,
        raw_tool_messages: rawTool,
        server_log_events: serverEvents.slice(0, 20),
        log_count: logRows.length,
      }, null, 2) };
    }
    return { statusCode: 200, body: JSON.stringify({
      ok: true,
      call_id: c.id,
      started: cj.startedAt, ended: cj.endedReason,
      assistantId: cj.assistantId,
      caller_id: (cj.customer && cj.customer.number) || null,
      dialed_number: (cj.phoneNumber && cj.phoneNumber.number) || cj.phoneNumberId || null,
      caller_id_masked: !!(cj.customer && /2802949$/.test(String(cj.customer.number || ''))),
      transcript_tail: String(cj.transcript || '').slice(-600),
      tool_events: toolEvents,
    }, null, 2) };
  }

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
    const inlineTools = Array.isArray(model.tools) ? model.tools : [];
    return { statusCode: 200, body: JSON.stringify({
      ok: true,
      assistant: { id: inbound.id, model_provider: model.provider, model: model.model },
      attached_toolIds: beforeIds.map((id) => ({ id, ...(byId[id] || { name: 'MISSING/deleted' }) })),
      inline_model_tools: inlineTools.map((t) => ({ type: t.type, name: tname(t), url: (t.server && t.server.url) || '(none)' })),
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

  // Dump voice-call config: transferCall destinations + analysis/summary + recording.
  if (action === 'voice') {
    const f = full.json || {};
    const tools = Array.isArray(model.tools) ? model.tools : [];
    const transfer = tools.find((t) => t.type === 'transferCall') || null;
    return { statusCode: 200, body: JSON.stringify({
      ok: true,
      transferCall: transfer ? { destinations: transfer.destinations || transfer.function && transfer.function.destinations || null, raw: transfer } : 'NONE',
      analysisPlan: f.analysisPlan || null,
      artifactPlan: f.artifactPlan || null,
      serverUrl: f.serverUrl || (f.server && f.server.url) || null,
    }, null, 2) };
  }

  // Route live transfers to Danielle (the office) only — Danielle handles all calls.
  if (action === 'settransfer') {
    const tools = Array.isArray(model.tools) ? model.tools.slice() : [];
    let found = false;
    const newTools = tools.map((t) => {
      if (t.type !== 'transferCall') return t;
      found = true;
      return Object.assign({}, t, { destinations: [
        { type: 'number', number: '+16154850713', message: 'One second, connecting you with our office.' },
        { type: 'number', number: '+16154855795', message: 'One second, getting you the owner.' },
      ] });
    });
    const patch = await vapi('PATCH', `/assistant/${inbound.id}`, key, { model: Object.assign({}, model, { tools: newTools }) });
    const verify = await vapi('GET', `/assistant/${inbound.id}`, key);
    const vt = ((verify.json && verify.json.model && verify.json.model.tools) || []).find((t) => t.type === 'transferCall');
    return { statusCode: 200, body: JSON.stringify({ ok: patch.ok, found, destinations: (vt && vt.destinations) || null }, null, 2) };
  }

  // Turn ON call Summary (and success-eval) so the call log + daily review have content.
  if (action === 'voiceon') {
    const f = full.json || {};
    const ap = Object.assign({}, f.analysisPlan || {});
    ap.summaryPlan = Object.assign({}, ap.summaryPlan || {}, { enabled: true });
    const patch = await vapi('PATCH', `/assistant/${inbound.id}`, key, { analysisPlan: ap });
    const verify = await vapi('GET', `/assistant/${inbound.id}`, key);
    const vap = (verify.json && verify.json.analysisPlan) || {};
    return { statusCode: 200, body: JSON.stringify({ ok: patch.ok, patch_status: patch.status, summary_enabled: !!(vap.summaryPlan && vap.summaryPlan.enabled) }) };
  }

  // Pull the current system prompt.
  if (action === 'prompt') {
    const msgs = Array.isArray(model.messages) ? model.messages : [];
    const sys = msgs.find((m) => m.role === 'system');
    return { statusCode: 200, body: JSON.stringify({ ok: true, has_system: !!sys, system_prompt: (sys && sys.content) || '' }) };
  }

  // Replace the system prompt. POST {prompt:"..."} in the body.
  if (action === 'setprompt') {
    let parsed = {}; try { parsed = JSON.parse(event.body || '{}'); } catch (_) {}
    const newPrompt = String(parsed.prompt || '');
    if (newPrompt.length < 50) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'prompt too short / missing in POST body' }) };
    const msgs = Array.isArray(model.messages) ? model.messages.slice() : [];
    const i = msgs.findIndex((m) => m.role === 'system');
    if (i >= 0) msgs[i] = Object.assign({}, msgs[i], { content: newPrompt });
    else msgs.unshift({ role: 'system', content: newPrompt });
    const patch = await vapi('PATCH', `/assistant/${inbound.id}`, key, { model: Object.assign({}, model, { messages: msgs }) });
    const verify = await vapi('GET', `/assistant/${inbound.id}`, key);
    const vMsgs = (verify.json && verify.json.model && verify.json.model.messages) || [];
    const vSys = vMsgs.find((m) => m.role === 'system');
    return { statusCode: 200, body: JSON.stringify({ ok: patch.ok, patch_status: patch.status, applied_len: (vSys && vSys.content || '').length, mentions_ahs: /ahs/i.test((vSys && vSys.content) || '') }) };
  }

  // THE REAL FIX: the assistant's INLINE model.tools point straight at Xano, so
  // Vapi bypasses the proxy and Xano 400s on the wrapped envelope. Repoint every
  // inline function tool at the proxy. Drop the 5 that duplicate our standalone
  // toolId tools (those already proxy + have the best descriptions). Leave
  // transferCall / non-function tools alone.
  if (action === 'fix') {
    const ourNames = new Set(TOOLS.map((t) => t.name));
    const inline = Array.isArray(model.tools) ? model.tools : [];
    const before = inline.map((t) => ({ type: t.type, name: tname(t), url: (t.server && t.server.url) || '(none)' }));
    const newTools = [];
    const dropped = [];
    const repointed = [];
    for (const t of inline) {
      if (t.type !== 'function') { newTools.push(t); continue; }
      const n = tname(t);
      if (ourNames.has(n)) { dropped.push(n); continue; } // covered by toolId version
      const nt = Object.assign({}, t, { server: Object.assign({}, t.server, { url: PROXY }) });
      newTools.push(nt);
      repointed.push(n);
    }
    if (q.dryrun === '1') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, dryrun: true, before, would_repoint: repointed, would_drop_dupes: dropped, keep_toolIds: beforeIds.length }, null, 2) };
    }
    const patch = await vapi('PATCH', `/assistant/${inbound.id}`, key, { model: Object.assign({}, model, { tools: newTools }) });
    const verify = await vapi('GET', `/assistant/${inbound.id}`, key);
    const vTools = (verify.json && verify.json.model && verify.json.model.tools) || [];
    const after = vTools.map((t) => ({ type: t.type, name: tname(t), url: (t.server && t.server.url) || '(none)' }));
    const stillXano = after.filter((t) => /xano\.io/.test(t.url)).map((t) => t.name);
    return { statusCode: 200, body: JSON.stringify({
      ok: patch.ok, patch_status: patch.status,
      repointed, dropped_dupes: dropped,
      after, still_pointing_at_xano: stillXano,
      verify_clean: stillXano.length === 0,
    }, null, 2) };
  }

  return { statusCode: 400, body: 'unknown action' };
};
