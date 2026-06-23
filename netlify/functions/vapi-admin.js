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

  // Create (or &update_id=<id> to update) the outbound "Ant Availability Collector"
  // assistant — step 3 of the availability cascade. Copies voice/transcriber/model
  // from the inbound assistant so it sounds identical, and attaches the
  // save_availability tool (routes through this same vapi-tool proxy →
  // set-job-availability). Returns the new assistant_id to wire into the cascade.
  if (action === 'setup_availability') {
    const INBOUND_ID = '7cc98b0c-54a7-4d19-bd48-6dfac606e55d';
    const inb = (await vapi('GET', `/assistant/${INBOUND_ID}`, key)).json || {};
    const PROMPT = [
      "You are Ant, the friendly scheduling assistant for TN Appliance Exchange. You are calling a customer to find out when they are available so we can schedule their appliance repair quickly. The job id is {{job_id}} and the appliance is {{appliance_type}}.",
      "",
      "Do this, briefly and warmly:",
      "1. Greet them and say you're calling from TN Appliance Exchange about their repair.",
      "2. Ask what days and times work best for them, and whether there are any days or times they absolutely cannot do.",
      "3. Repeat back what you heard to confirm.",
      "4. Call the save_availability tool with job_id {{job_id}}, available (their open days/times), and unavailable (the days/times they can't do; empty string if none).",
      "5. Thank them, tell them we'll text to confirm their day, and end the call.",
      "",
      "Rules: keep it short and natural — this is a quick call. The more open they are, the faster we can come; mention that if they're very restricted. NEVER discuss diagnosis, parts, or pricing — you are only here to capture scheduling availability. If they can't talk now, politely offer to text them instead and end the call. Always include job_id {{job_id}} when saving.",
    ].join('\n');
    const tool = {
      type: 'function',
      function: {
        name: 'save_availability',
        description: "Save the customer's available and unavailable days/times so the office can schedule them. Call this once you have their availability.",
        parameters: {
          type: 'object',
          properties: {
            job_id: { type: 'string', description: 'The job id (provided in the call variables as job_id).' },
            available: { type: 'string', description: 'Days/times the customer CAN do (e.g. "weekday mornings, Tue or Thu after 2").' },
            unavailable: { type: 'string', description: 'Days/times they CANNOT do (e.g. "not Fridays, no mornings"). Empty string if none.' },
          },
          required: ['job_id', 'available'],
        },
      },
      server: { url: PROXY },
    };
    const body = {
      name: 'Ant Availability Collector',
      firstMessage: "Hi, this is Ant calling from T-N Appliance Exchange about your repair — do you have a quick second so we can get you scheduled?",
      model: {
        provider: (inb.model && inb.model.provider) || 'anthropic',
        model: (inb.model && inb.model.model) || 'claude-sonnet-4-5-20250929',
        messages: [{ role: 'system', content: PROMPT }],
        tools: [tool],
      },
    };
    if (inb.voice) body.voice = inb.voice;
    if (inb.transcriber) body.transcriber = inb.transcriber;
    body.backgroundSound = inb.backgroundSound || 'off'; // no call-center ambiance
    const res = q.update_id
      ? await vapi('PATCH', `/assistant/${q.update_id}`, key, body)
      : await vapi('POST', '/assistant', key, body);
    return { statusCode: 200, body: JSON.stringify({
      ok: res.ok, status: res.status,
      assistant_id: res.json && res.json.id,
      name: res.json && res.json.name,
      copied_voice: !!inb.voice, copied_transcriber: !!inb.transcriber,
      error: res.ok ? null : res.json,
    }, null, 2) };
  }

  // Patch an assistant's backgroundSound (kill the call-center ambiance).
  // ?action=setbg&id=<assistantId>&value=off  (value defaults to 'off')
  if (action === 'setbg') {
    const id = String(q.id || '').trim();
    if (!id) return { statusCode: 400, body: JSON.stringify({ ok: false, error: '?id=<assistantId> required' }) };
    const val = String(q.value || 'off').trim();
    const res = await vapi('PATCH', `/assistant/${id}`, key, { backgroundSound: val });
    return { statusCode: 200, body: JSON.stringify({ ok: res.ok, status: res.status, id, backgroundSound: val, error: res.ok ? null : res.json }, null, 2) };
  }

  // Place one outbound test call with a given assistant. Used to hear the new
  // availability collector. ?action=testcall&to=+16154855795 (optional
  // &assistant_id=, &from_id=, &name=, &appliance=, &job_id=). Defaults to the
  // availability assistant + the confirmed-working Twilio TN dial-from.
  if (action === 'testcall') {
    const to = String(q.to || '').trim();
    if (!to) return { statusCode: 400, body: JSON.stringify({ ok: false, error: '?to=<E.164 number> required' }) };
    const assistantId = String(q.assistant_id || 'f24701a2-3b6b-4102-b028-3d43ed36e303').trim();
    const fromId = String(q.from_id || 'd57d5cf2-60a7-46e6-a7f0-24ed652c1f31').trim();
    const callBody = {
      assistantId,
      phoneNumberId: fromId,
      customer: { number: to },
      assistantOverrides: {
        variableValues: {
          customer_first_name: q.name || 'there',
          appliance_type: q.appliance || 'appliance',
          job_id: String(q.job_id || '0'),
        },
      },
    };
    const res = await vapi('POST', '/call', key, callBody);
    return { statusCode: 200, body: JSON.stringify({ ok: res.ok, status: res.status, call_id: res.json && res.json.id, to, assistant_id: assistantId, error: res.ok ? null : res.json }, null, 2) };
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
      const msgs = Array.isArray(c.messages) ? c.messages : [];
      const roles = msgs.map((m) => String(m.role || '').toLowerCase());
      const had_bot = roles.includes('bot') || roles.includes('assistant');
      const had_user = roles.includes('user');
      const n_tools = msgs.filter((m) => m.toolCalls || m.role === 'tool_calls' || m.role === 'function').length;
      return {
        started,
        dur,
        dir: (c.type || '').replace('PhoneCall', ''),
        from: (c.customer && c.customer.number) || (c.phoneNumber && c.phoneNumber.number) || '',
        ended_reason: c.endedReason || c.status || '',
        transcript_len: (c.transcript || '').length,
        ant_spoke: had_bot,
        caller_spoke: had_user,
        n_tools,

        transcript: String(c.transcript || "").slice(-700),
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

  // Add a "one moment" request-start filler to every inline function tool so Ant
  // never goes dead-silent during a lookup — the dropped-call dead-air fix. Vapi
  // speaks the request-start message the instant a tool is invoked, so there's no
  // silence while the backend responds. Single PATCH, preserves every tool (just
  // adds a messages[] to each). Idempotent — re-running overwrites with the same
  // single request-start. Override text with &text=...
  if (action === 'filler') {
    const FILLER = q.text || 'One moment — let me pull that up for you.';
    const tools = Array.isArray(model.tools) ? model.tools : [];
    if (!tools.length) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no inline model.tools to patch' }) };
    let patched = 0;
    const newTools = tools.map((t) => {
      if (t.type !== 'function') return t;
      patched++;
      return Object.assign({}, t, { messages: [{ type: 'request-start', content: FILLER }] });
    });
    const resp = await vapi('PATCH', `/assistant/${inbound.id}`, key, { model: Object.assign({}, model, { tools: newTools }) });
    const verify = await vapi('GET', `/assistant/${inbound.id}`, key);
    const vt = (verify.json && verify.json.model && verify.json.model.tools) || [];
    const withFiller = vt.filter((t) => Array.isArray(t.messages) && t.messages.some((m) => m.type === 'request-start')).length;
    return { statusCode: 200, body: JSON.stringify({
      ok: resp.ok,
      patch_status: resp.status,
      tools_patched: patched,
      verify_total_tools: vt.length,
      verify_with_filler: withFiller,
      filler_text: FILLER,
      patch_error: resp.ok ? null : resp.json,
    }, null, 2) };
  }

  // Add the 3 caller-identification tools the live assistant is MISSING
  // (lookup_customer_by_phone / lookup_by_claim_number / search_customers).
  // Without them, when a caller gives their name/phone/claim Ant has no way to
  // look them up -> it goes dead-silent -> silence-timed-out. The proxy
  // (vapi-tool.js) already fully supports these three. Single inline-tools PATCH
  // that PRESERVES every existing tool; each new tool gets the request-start
  // filler so Ant talks during the lookup. Idempotent.
  if (action === 'addlookups') {
    const FILLER = q.text || 'One moment — let me pull that up for you.';
    const LOOKUPS = [
      { name: 'lookup_customer_by_phone', description: "Look up a caller by their phone number to find their account + open jobs. Use this first whenever you have the caller's number.", params: { phone: { type: 'string', description: 'Caller phone number.' } }, required: ['phone'] },
      { name: 'lookup_by_claim_number', description: 'Look up a job by the claim, dispatch, or work-order number the caller or warranty company gives. Returns status, scheduled day, and tech.', params: { claim_or_dispatch_number: { type: 'string', description: 'The claim / dispatch / work-order number.' } }, required: ['claim_or_dispatch_number'] },
      { name: 'search_customers', description: 'Find a caller by name (or name + city) when you do not have a matching phone or claim number.', params: { query: { type: 'string', description: 'Full name, optionally with city.' } }, required: ['query'] },
    ];
    const mk = (d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: { type: 'object', properties: d.params, required: d.required } }, server: { url: PROXY }, messages: [{ type: 'request-start', content: FILLER }] });
    const existing = Array.isArray(model.tools) ? model.tools : [];
    const names = new Set(LOOKUPS.map((d) => d.name));
    const kept = existing.filter((t) => !names.has(tname(t)));
    const newTools = kept.concat(LOOKUPS.map(mk));
    const resp = await vapi('PATCH', `/assistant/${inbound.id}`, key, { model: Object.assign({}, model, { tools: newTools }) });
    const verify = await vapi('GET', `/assistant/${inbound.id}`, key);
    const vt = (verify.json && verify.json.model && verify.json.model.tools) || [];
    const present = LOOKUPS.map((d) => d.name).filter((n) => vt.some((t) => tname(t) === n));
    return { statusCode: 200, body: JSON.stringify({ ok: resp.ok, patch_status: resp.status, total_tools_before: existing.length, total_tools_after: vt.length, lookups_present: present, all_tool_names: vt.map((t) => tname(t)), patch_error: resp.ok ? null : resp.json }, null, 2) };
  }

  // Caller-ID auto-recognition: at the start of EVERY call, Ant silently looks
  // up the caller's number and greets them by name if it matches — instead of
  // asking who they are (the ask-and-stall step that was killing calls). Now
  // possible because RingCentral is gone and Telnyx passes the real caller ID.
  // Idempotent — wrapped in markers, re-running replaces the same block.
  if (action === 'callerid') {
    const START = '<!-- CALLERID-START -->', END = '<!-- CALLERID-END -->';
    const BLOCK = `${START}
## CALLER ID — recognize them automatically (DO THIS FIRST, before your opening line)
This caller is calling from {{customer.number}}. Before you do anything else, SILENTLY call lookup_customer_by_phone with that number.
- If it returns a match AND caller_id_masked is false: greet them BY NAME and reference their job — e.g. "Hi {first name}! I've got your {appliance} here — calling about that?" You already know who they are; do NOT ask them to identify themselves.
- If there is no match, OR caller_id_masked is true (their number didn't resolve to an account): just give your normal opening and then ask for their name, claim/dispatch number, or a phone number to look up.
Never make a caller repeat information you can already see from their caller ID.
${END}`;
    const msgs = Array.isArray(model.messages) ? model.messages.slice() : [];
    const sysIdx = msgs.findIndex((m) => m.role === 'system');
    if (sysIdx < 0) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no system message on assistant' }) };
    let content = String(msgs[sysIdx].content || '');
    content = content.replace(new RegExp(START + '[\\s\\S]*?' + END, 'g'), '').replace(/\n{3,}/g, '\n\n').trim();
    content = content + '\n\n' + BLOCK + '\n';
    msgs[sysIdx] = Object.assign({}, msgs[sysIdx], { content });
    const resp = await vapi('PATCH', `/assistant/${inbound.id}`, key, { model: Object.assign({}, model, { messages: msgs }) });
    const verify = await vapi('GET', `/assistant/${inbound.id}`, key);
    const vm = (verify.json && verify.json.model && verify.json.model.messages) || [];
    const present = vm.some((m) => /CALLERID-START/.test(String(m.content || '')));
    return { statusCode: 200, body: JSON.stringify({ ok: resp.ok, patch_status: resp.status, callerid_block_present: present, prompt_len: content.length, patch_error: resp.ok ? null : resp.json }, null, 2) };
  }

  // Set the inbound greeting (first line the caller hears). Default is a clean,
  // recognizable "Hello! This is Tennessee Appliance." — spelled out so the TTS
  // can't garble "Ant's" -> "Anne's" or "TN" -> "Tian". Override with ?greeting=.
  if (action === 'setgreeting') {
    const oldMsg = (full.json && full.json.firstMessage) || '';
    const greeting = q.greeting || 'Hello! This is Tennessee Appliance. How can I help you today?';
    const resp = await vapi('PATCH', `/assistant/${inbound.id}`, key, { firstMessage: greeting });
    const verify = await vapi('GET', `/assistant/${inbound.id}`, key);
    const now = (verify.json && verify.json.firstMessage) || '';
    return { statusCode: 200, body: JSON.stringify({
      ok: resp.ok, patch_status: resp.status,
      old_greeting: oldMsg, new_greeting: now, matches: now === greeting,
      patch_error: resp.ok ? null : resp.json,
    }, null, 2) };
  }

  // Sweep ALL assistants and normalize the spoken brand in their greeting to
  // "Tennessee Appliance" — kills "Ant's assistant" -> "Anne's" and "TN/T-N
  // Appliance Exchange" -> "Tian" across every call a customer hears. Touches
  // ONLY firstMessage (the spoken opener), never the system prompt / logic.
  if (action === 'unifygreeting') {
    const list = listFrom(await vapi('GET', '/assistant', key));
    const reps = [
      [/Ant[''’]s assistant calling from (?:the\s+)?T[\s-]?N Appliance(?: Exchange)?/gi, 'Tennessee Appliance calling'],
      [/Ant[''’]s assistant from (?:the\s+)?T[\s-]?N Appliance(?: Exchange)?/gi, 'Tennessee Appliance'],
      [/it[''’]?s Ant\b/gi, "it's Tennessee Appliance"],
      [/this is Ant[''’]s assistant/gi, 'this is Tennessee Appliance'],
      [/Ant[''’]s assistant/gi, 'Tennessee Appliance'],
      [/Ant calling from (?:the\s+)?T[\s-]?N Appliance(?: Exchange)?/gi, 'Tennessee Appliance calling'],
      [/T[\s-]?N Appliance Exchange/gi, 'Tennessee Appliance'],
      [/T[\s-]?N Appliance/gi, 'Tennessee Appliance'],
      [/Tennessee Appliance Exchange/gi, 'Tennessee Appliance'],
      // de-dupe any redundancy the above can produce, e.g. "Tennessee Appliance
      // calling from Tennessee Appliance" -> "Tennessee Appliance calling".
      [/Tennessee Appliance calling from Tennessee Appliance/gi, 'Tennessee Appliance calling'],
      [/Tennessee Appliance from Tennessee Appliance/gi, 'Tennessee Appliance'],
    ];
    const fix = (s) => { let o = String(s || ''); for (const [re, to] of reps) o = o.replace(re, to); return o; };
    const results = [];
    for (const a of list) {
      const fm = a.firstMessage || '';
      const newFm = fix(fm);
      if (fm && newFm !== fm && newFm.trim()) {
        const resp = await vapi('PATCH', `/assistant/${a.id}`, key, { firstMessage: newFm });
        results.push({ name: a.name, id: a.id, changed: true, ok: resp.ok, old: fm, 'new': newFm });
      } else {
        results.push({ name: a.name, id: a.id, changed: false, firstMessage: fm ? fm.slice(0, 80) : '(none/dynamic)' });
      }
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, count: list.length, changed: results.filter((r) => r.changed).length, results }, null, 2) };
  }

  // Warranty-company self-serve relay — when Ant recognizes the caller is the
  // warranty company (AHS/HSA/Frontdoor/CSC/dispatcher), it asks for the claim #
  // + what they need and PULLS it, instead of taking a message (Teddy, 2026-06-22).
  // Idempotent (marker-wrapped); re-running replaces the same block.
  if (action === 'warrantyrelay') {
    const START = '<!-- WARRANTYRELAY-START -->', END = '<!-- WARRANTYRELAY-END -->';
    const BLOCK = `${START}
## WARRANTY-COMPANY CALLER — be their instant self-serve database (don't take a message)
If the caller is from the warranty company — they mention AHS, American Home Shield, HSA, Frontdoor, ServicePower, "dispatcher", "CSC", a claim or dispatch number, or that they're calling ON BEHALF of a member/customer — switch into fast lookup mode. You have all of it in the database; pull it for them.
Open with, warmly: "Sure — what's the claim or dispatch number you're looking for, and what do you need to know? I can pull it right up."
Then call lookup_by_claim_number with that number and answer their SPECIFIC question, confidently and concretely:
- Why it's waiting: "We've diagnosed it — we're waiting on the part, expected {part ETA}. The moment it's in we schedule the install."
- Scheduled?: "She's scheduled with {tech} for {day} — she gets a live arrival window that morning." (We schedule by DAY, not a clock time.)
- Have we been out yet / is it scheduled: use been_out / is_scheduled.
- Read back tech, appliance, parts ETA, status — whatever they ask.
If the claim isn't found, say it may be a brand-new dispatch you haven't received and offer to take the details. NEVER just take a message when you can pull the answer.
${END}`;
    const msgs = Array.isArray(model.messages) ? model.messages.slice() : [];
    const sysIdx = msgs.findIndex((m) => m.role === 'system');
    if (sysIdx < 0) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no system message on assistant' }) };
    let content = String(msgs[sysIdx].content || '');
    content = content.replace(new RegExp(START + '[\\s\\S]*?' + END, 'g'), '').replace(/\n{3,}/g, '\n\n').trim();
    content = content + '\n\n' + BLOCK + '\n';
    msgs[sysIdx] = Object.assign({}, msgs[sysIdx], { content });
    const resp = await vapi('PATCH', `/assistant/${inbound.id}`, key, { model: Object.assign({}, model, { messages: msgs }) });
    const verify = await vapi('GET', `/assistant/${inbound.id}`, key);
    const vm = (verify.json && verify.json.model && verify.json.model.messages) || [];
    const present = vm.some((m) => /WARRANTYRELAY-START/.test(String(m.content || '')));
    return { statusCode: 200, body: JSON.stringify({ ok: resp.ok, patch_status: resp.status, warrantyrelay_block_present: present, prompt_len: content.length, patch_error: resp.ok ? null : resp.json }, null, 2) };
  }

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

  // Wire Ant's live-transfer to the Office Phone app (office-phone.html via the
  // Telnyx "Ant office phone" Credential Connection). When Teddy/Danielle are
  // flipped On, Ant can hand a live caller to their app — screen-pop and all.
  // When they're Off (no SIP registration) the transfer fails fast and Ant is
  // told to take a message instead. Idempotent. &apply=off removes it again.
  //   enable:  ...&action=wireoffice            (optional &sip=sip:user@sip.telnyx.com)
  //   disable: ...&action=wireoffice&apply=off
  if (action === 'wireoffice') {
    const OFFICE_SIP_URI = q.sip || 'sip:userteddy74923@sip.telnyx.com';
    const OFF = String(q.apply || '').toLowerCase() === 'off';
    const tools = Array.isArray(model.tools) ? model.tools.slice() : [];

    // 1) tools: drop any existing transferCall, re-add (unless disabling).
    let newTools = tools.filter((t) => t.type !== 'transferCall');
    // ensure capture_callback fallback is present
    if (!newTools.some((t) => tname(t) === 'capture_callback')) {
      newTools.push(toolBody(TOOLS.find((t) => t.name === 'capture_callback')));
    }
    if (!OFF) {
      newTools.push({
        type: 'transferCall',
        destinations: [{
          type: 'sip',
          sipUri: OFFICE_SIP_URI,
          // Tell the caller we're connecting them.
          message: 'One second — let me connect you with our office.',
          // WARM transfer: Vapi dials the office phone, waits for it to answer,
          // speaks a short note, THEN bridges the caller — Vapi stays in the
          // media path so audio reliably flows (a blind/REFER transfer to a
          // WebRTC endpoint was ringing then going silent).
          transferPlan: {
            mode: 'warm-transfer-say-message',
            message: 'Connecting you with a caller on the office line now.',
          },
        }],
      });
    }

    // 2) prompt: add/remove a marked block telling Ant when to transfer.
    const msgs = Array.isArray(model.messages) ? model.messages.slice() : [];
    const sysIdx = msgs.findIndex((m) => m.role === 'system');
    const sysContent = sysIdx >= 0 ? String(msgs[sysIdx].content || '') : '';
    const OX_START = '<!-- OX-START -->';
    const OX_END = '<!-- OX-END -->';
    const OX_BLOCK = OX_START + '\n' +
      '## Reaching a live person (the office phone)\n' +
      'If the caller truly needs a real person — they ask for one, they are upset, or it is ' +
      'something you genuinely cannot resolve — you CAN connect them. Use the transferCall ' +
      'function; it rings the office phone app Teddy and Danielle carry.\n' +
      '- Set expectations first: "Let me try to connect you with our office now — one moment," then transfer.\n' +
      '- If no one picks up (they may be away from the app), do NOT leave the caller hanging. Apologize, ' +
      'then use capture_callback to take their name, number, and a one-line summary so the office calls ' +
      'them right back, usually within a few business hours.\n' +
      '- Never promise a specific person or an immediate callback if the transfer does not connect. Be ' +
      'honest: "I could not reach someone live just now, but I have your message and the office will call you back."\n' +
      '- For routine status or scheduling you can already handle, just handle it — do not transfer unnecessarily.\n' + OX_END;
    const hasBlock = sysContent.includes(OX_START);
    let newSys = sysContent;
    if (!OFF && !hasBlock) newSys = sysContent.trimEnd() + '\n\n' + OX_BLOCK + '\n';
    else if (OFF && hasBlock) newSys = sysContent.replace(new RegExp('\\n*' + OX_START + '[\\s\\S]*?' + OX_END + '\\n*', 'g'), '\n').trimEnd() + '\n';
    if (sysIdx >= 0) msgs[sysIdx] = Object.assign({}, msgs[sysIdx], { content: newSys });
    else if (newSys) msgs.unshift({ role: 'system', content: newSys });

    const patch = await vapi('PATCH', `/assistant/${inbound.id}`, key, { model: Object.assign({}, model, { tools: newTools, messages: msgs }) });
    const verify = await vapi('GET', `/assistant/${inbound.id}`, key);
    const vm = (verify.json && verify.json.model) || {};
    const vt = (vm.tools || []).find((t) => t.type === 'transferCall');
    const vSys = (vm.messages || []).find((m) => m.role === 'system');
    return { statusCode: 200, body: JSON.stringify({
      ok: patch.ok, patch_status: patch.status, disabled: OFF,
      transfer_destinations: (vt && vt.destinations) || null,
      transfer_block_installed: !!(vSys && String(vSys.content || '').includes(OX_START)),
      has_capture_callback: (vm.tools || []).some((t) => tname(t) === 'capture_callback'),
    }, null, 2) };
  }

  // Surgical fallback fix (2026-06-16): ADD capture_callback (so Ant can take a
  // message) and REMOVE transferCall (which fails ~35% and drops callers — no
  // live agent to hand off to right now). Leaves the other inline tools UNTOUCHED.
  // This is the safe alternative to `apply` (whose TOOLS array is stale).
  if (action === 'fixfallback') {
    const tools = Array.isArray(model.tools) ? model.tools.slice() : [];
    let removedTransfer = false;
    let newTools = tools.filter((t) => {
      if (t.type === 'transferCall') { removedTransfer = true; return false; }
      return true;
    });
    const hasCapture = newTools.some((t) => tname(t) === 'capture_callback');
    let addedCapture = false;
    if (!hasCapture) {
      newTools.push({
        type: 'function',
        function: {
          name: 'capture_callback',
          description: 'Take a message when you cannot fully resolve the call OR the caller asks for a live person. There is NO live agent available to transfer to right now — do not promise a transfer. Instead say a human will call them back, and collect name + best callback number + a one-line summary.',
          parameters: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' }, summary: { type: 'string' }, caller_type: { type: 'string' }, ref: { type: 'string' } }, required: ['name', 'phone', 'summary', 'caller_type'] },
        },
        server: { url: PROXY },
      });
      addedCapture = true;
    }
    const patch = await vapi('PATCH', `/assistant/${inbound.id}`, key, { model: Object.assign({}, model, { tools: newTools }) });
    const verify = await vapi('GET', `/assistant/${inbound.id}`, key);
    const vt = (verify.json && verify.json.model && verify.json.model.tools) || [];
    return { statusCode: 200, body: JSON.stringify({
      ok: patch.ok, patch_status: patch.status, removedTransfer, addedCapture,
      now_tools: vt.map((t) => tname(t) || t.type),
    }, null, 2) };
  }

  // Create (or update) the "Ant Tech Report" voice assistant: clones the inbound
  // voice/transcriber/model so it sounds identical, with a context-aware prompt +
  // two tools (pull the existing TDR, then submit the completed one). The tech
  // talks, Ant fills the report. (2026-06-16)
  if (action === 'createreport') {
    const f = full.json || {};
    const REPORT_PROMPT = [
      'You are Ant, helping a TN Appliance Exchange TECHNICIAN file their job report (the TDR) by voice. The tech just finished a job and would rather talk than type. Be fast, warm, natural — they are tired, hands dirty, ready to move on.',
      '',
      'STEP 1 — KNOW THE JOB. As soon as you have the job_id (it may be passed in the call; otherwise ask "which job — the job number or the customer name"), call get_tech_report_context with that job_id. It returns what is ALREADY in the report (customer_complaint, pre_diagnosis from Teddy, parts) and a still_needed list of what is missing.',
      '',
      'STEP 2 — FILL THE GAPS ONLY. Do NOT re-ask what is already filled. Briefly confirm the known parts ("Teddy pre-diagnosed the lid lock — did that hold up?") and ask only for what is in still_needed: the diagnosis (what was actually wrong), failed_component (the part that failed), repair_completed (what you did + is it DONE or a second visit), verified_part_number (the part used — read it back), and labor_time_hours. If the tech volunteers several at once ("replaced the lid lock W10887210, about an hour, working now"), capture them all — do not make them repeat.',
      '',
      'STEP 3 — FILE IT. Read back a one-line summary. On the tech yes, call submit_tech_tdr with EVERYTHING — the fields from the context PLUS what the tech told you, merged so the report is complete. Always include job_id and technician_id. Then say "report is filed."',
      '',
      'STEP 4 — SWEEP THE BACKLOG. After filing the current job, call get_my_open_reports with the technician_id. If it returns any open reports, do NOT let the tech off the phone yet — proactively bring each up: "Quick one — you still have [customer]\'s [appliance] from [when] open. 20 seconds, what was wrong with it?" Then knock it out the same way (call get_tech_report_context for THAT job_id, ask only the gaps, submit_tech_tdr). One call, whole backlog cleared. If there are none, tell them they are all caught up.',
      '',
      'You are the tech scribe, not their boss. Never lecture. Keep it tight.',
    ].join('\n');

    const reportTools = [
      { type: 'function', server: { url: PROXY }, function: {
        name: 'get_tech_report_context',
        description: 'Pull what is already in this job report (TDR) so you only ask the tech for what is missing. Call this FIRST with the job_id.',
        parameters: { type: 'object', properties: { job_id: { type: 'number', description: 'the job id' } }, required: ['job_id'] },
      } },
      { type: 'function', server: { url: PROXY }, function: {
        name: 'submit_tech_tdr',
        description: 'File the completed report. Include the fields from get_tech_report_context PLUS what the tech told you, merged.',
        parameters: { type: 'object', properties: {
          job_id: { type: 'number' }, technician_id: { type: 'number' },
          diagnosis: { type: 'string' }, failed_component: { type: 'string' }, failure_cause: { type: 'string' },
          repair_completed: { type: 'string' }, second_visit_needed: { type: 'boolean' },
          verified_part_number: { type: 'string' }, labor_time_hours: { type: 'number' }, technician_notes: { type: 'string' },
        }, required: ['job_id', 'diagnosis'] },
      } },
      { type: 'function', server: { url: PROXY }, function: {
        name: 'get_my_open_reports',
        description: "After filing the current report, call this with the technician_id to find the tech's OTHER recent jobs whose report is still missing/incomplete — so you can sweep the backlog. Returns reports:[{job_id, customer, appliance, when}].",
        parameters: { type: 'object', properties: { technician_id: { type: 'number', description: 'the tech filing reports' }, days_back: { type: 'number', description: 'days back to check (default 3)' } }, required: ['technician_id'] },
      } },
    ];

    const body = {
      name: 'Ant Tech Report',
      firstMessage: "Hey, it's Ant — let's knock out your report real quick. What job are you filing for?",
      model: { provider: model.provider || 'anthropic', model: model.model || 'claude-sonnet-4-5-20250929', messages: [{ role: 'system', content: REPORT_PROMPT }], tools: reportTools },
      voice: f.voice || undefined,
      transcriber: f.transcriber || undefined,
      server: { url: 'https://tnapplianceexchange.net/.netlify/functions/vapi-webhook' },
    };

    const existing = listFrom(aResp).find((a) => (a.name || '').trim().toLowerCase() === 'ant tech report');
    const resp = existing
      ? await vapi('PATCH', `/assistant/${existing.id}`, key, body)
      : await vapi('POST', '/assistant', key, body);
    return { statusCode: 200, body: JSON.stringify({
      ok: resp.ok, status: resp.status,
      assistant_id: (resp.json && resp.json.id) || (existing && existing.id) || null,
      name: 'Ant Tech Report', updated: !!existing,
    }, null, 2) };
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

  // Multilingual control. Read-only by default (dumps transcriber + voice +
  // whether the language block is installed). &apply=multi turns it on; &apply=
  // english reverts. Reversible + idempotent. The block + transcriber edits touch
  // ONLY language handling — every existing tool/prompt/destination is preserved.
  if (action === 'lang') {
    const f = full.json || {};
    const msgs = Array.isArray(model.messages) ? model.messages.slice() : [];
    const sysIdx = msgs.findIndex((m) => m.role === 'system');
    const sysContent = sysIdx >= 0 ? String(msgs[sysIdx].content || '') : '';
    const ML_START = '<!-- ML-START -->';
    const ML_END = '<!-- ML-END -->';
    const ML_BLOCK = ML_START + '\n' +
      '## Language — answer the caller in THEIR language\n' +
      'Detect the caller\'s language from their first words. If they speak Spanish, Vietnamese, ' +
      'Arabic, Hindi, or French, conduct the ENTIRE rest of the call in that language — every ' +
      'question, every confirmation, everything — fluently and naturally. If they speak English, ' +
      'or you are unsure, use English. If they switch languages mid-call, switch with them. Never ' +
      'announce that you are translating or switching; just speak their language. Your spoken ' +
      'opening line stays in English (you can\'t know their language until they speak).\n' + ML_END;
    const hasBlock = sysContent.includes(ML_START);
    const apply = String(q.apply || '').toLowerCase();

    if (!apply) {
      return { statusCode: 200, body: JSON.stringify({
        ok: true, mode: 'read_only',
        transcriber: f.transcriber || null,
        voice: f.voice || null,
        language_block_installed: hasBlock,
        hint: 'Add &apply=multi to enable, &apply=english to revert.',
      }, null, 2) };
    }

    // Build the new system prompt (add/remove the block idempotently).
    let newSys = sysContent;
    if (apply === 'multi' && !hasBlock) {
      newSys = sysContent.trimEnd() + '\n\n' + ML_BLOCK + '\n';
    } else if (apply === 'english' && hasBlock) {
      newSys = sysContent.replace(new RegExp('\\n*' + ML_START + '[\\s\\S]*?' + ML_END + '\\n*', 'g'), '\n').trimEnd() + '\n';
    }
    if (sysIdx >= 0) msgs[sysIdx] = Object.assign({}, msgs[sysIdx], { content: newSys });
    else msgs.unshift({ role: 'system', content: newSys });

    // Transcriber:
    //   multi    = Deepgram NOVA-3 multilingual code-switching — auto-detects
    //              English, Spanish, French, Hindi (+ DE/IT/JA/NL/RU/PT). Lower WER
    //              than nova-2 on English+Spanish too. (Vietnamese + Arabic are NOT
    //              in any code-switch model — those communities use the in-language
    //              web intake + SMS translation bridge, not the auto-detect line.)
    //              nova-3 uses 'keyterm' not 'keywords', so we drop the keywords
    //              array to avoid a param mismatch.
    //   english  = restore the EXACT original phone-tuned English transcriber.
    // Voice (Cartesia sonic-2) is already multilingual — left untouched.
    const ORIGINAL_EN = {
      provider: 'deepgram', model: 'nova-2-phonecall', language: 'en-US', smartFormat: true,
      keywords: ['AHS:2','ServicePower:2','Frontdoor:2','SquareTrade:2','Allstate:2','claim:2','dispatch:2','warranty:2','homeowner','Antioch','Nashville:2','Hammond','Walker','Whirlpool','Kenmore','fridge:2','dryer:2','washer:2','dishwasher:2','Vapi'],
      fallbackPlan: { transcribers: [{ language: 'en', provider: 'assembly-ai', formatTurns: true, disablePartialTranscripts: false }] },
    };
    let newTranscriber = f.transcriber || ORIGINAL_EN;
    let newVoice = f.voice || null;
    if (apply === 'multi') {
      newTranscriber = {
        provider: 'deepgram', model: 'nova-3', language: 'multi', smartFormat: true,
        fallbackPlan: { transcribers: [{ language: 'en', provider: 'assembly-ai', formatTurns: true, disablePartialTranscripts: false }] },
      };
      if (newVoice && /cartesia/i.test(newVoice.provider || '') && newVoice.model && !/sonic-2|multilingual/i.test(newVoice.model)) {
        newVoice = Object.assign({}, newVoice, { model: 'sonic-2' });
      }
    } else if (apply === 'english') {
      newTranscriber = ORIGINAL_EN;
    }

    const patchBody = { model: Object.assign({}, model, { messages: msgs }), transcriber: newTranscriber };
    if (newVoice) patchBody.voice = newVoice;
    const patch = await vapi('PATCH', `/assistant/${inbound.id}`, key, patchBody);
    const verify = await vapi('GET', `/assistant/${inbound.id}`, key);
    const vf = verify.json || {};
    const vSys = ((vf.model && vf.model.messages) || []).find((m) => m.role === 'system');
    return { statusCode: 200, body: JSON.stringify({
      ok: patch.ok, patch_status: patch.status, applied: apply,
      transcriber: vf.transcriber || null,
      voice: vf.voice || null,
      language_block_installed: !!(vSys && String(vSys.content || '').includes(ML_START)),
    }, null, 2) };
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

  // Add the send_quickcheck_link tool + a price-shopper deflection block to the
  // prompt. Idempotent + additive: preserves every existing tool and the entire
  // existing prompt; only appends what's missing. Reversible (remove the marked
  // section + the tool). (2026-06-20)
  if (action === 'addquickcheck') {
    const tools = Array.isArray(model.tools) ? model.tools.slice() : [];
    const msgs = Array.isArray(model.messages) ? model.messages.slice() : [];

    // 1) tool
    let addedTool = false;
    if (!tools.some((t) => tname(t) === 'send_quickcheck_link')) {
      tools.push({
        type: 'function',
        function: {
          name: 'send_quickcheck_link',
          description: "Text the caller the $50 Quick Check link. Use ONLY when the caller is paying OUT OF POCKET (not warranty/AHS/ServicePower) and is asking for a price, quote, ballpark, or how much a repair costs. Get their cell number first, then call this. After it runs, tell them what it says back.",
          parameters: { type: 'object', properties: { phone: { type: 'string', description: "the caller's cell number" }, name: { type: 'string', description: "caller's first name (optional)" } }, required: ['phone'] },
        },
        server: { url: PROXY },
      });
      addedTool = true;
    }

    // 2) prompt deflection block (idempotent via marker)
    const MARK = '## Out-of-pocket price-shoppers — route to the $50 Quick Check';
    const BLOCK = '\n\n' + MARK + '\n' + [
      'If a caller is paying OUT OF POCKET (not a warranty / AHS / ServicePower customer) and asks for a price, a quote, a "ballpark," or "how much" a repair costs, do NOT quote a number — we cannot price a repair sight-unseen, and a phone guess just burns the customer.',
      'Instead, route them to our $50 Quick Check: they send a quick video of the problem and a photo of the model sticker, a real tech gives them an honest diagnosis and their exact options within about two business hours, and the $50 is credited to their repair (most shops charge $125 just to show up).',
      'Ask for their cell number, then call the send_quickcheck_link tool with their phone (and first name if you have it) to TEXT them the link, and tell them what the tool says back.',
      'If they keep pushing for a number, gently repeat that the Quick Check is exactly how they get an accurate one. If they will not commit, stay friendly, mention they can start it at tnapplianceexchange.net, and do not drag the call out.',
      'NEVER send a warranty / AHS / ServicePower caller to the Quick Check — handle those normally.',
    ].join(' ');
    let addedPrompt = false;
    const i = msgs.findIndex((m) => m.role === 'system');
    if (i >= 0 && !String(msgs[i].content || '').includes(MARK)) {
      msgs[i] = Object.assign({}, msgs[i], { content: String(msgs[i].content || '') + BLOCK });
      addedPrompt = true;
    }

    if (q.dryrun === '1') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, dryrun: true, would_add_tool: addedTool, would_add_prompt: addedPrompt, current_tool_count: (model.tools || []).length }, null, 2) };
    }

    const patch = await vapi('PATCH', `/assistant/${inbound.id}`, key, { model: Object.assign({}, model, { tools, messages: msgs }) });
    const verify = await vapi('GET', `/assistant/${inbound.id}`, key);
    const vModel = (verify.json && verify.json.model) || {};
    const vTools = (vModel.tools || []).map((t) => tname(t) || t.type);
    const vSys = (vModel.messages || []).find((m) => m.role === 'system');
    return { statusCode: 200, body: JSON.stringify({
      ok: patch.ok, patch_status: patch.status,
      addedTool, addedPrompt,
      tool_present: vTools.includes('send_quickcheck_link'),
      prompt_has_block: /Out-of-pocket price-shoppers/.test((vSys && vSys.content) || ''),
      tool_count: vTools.length, now_tools: vTools,
    }, null, 2) };
  }

  return { statusCode: 400, body: 'unknown action' };
};
