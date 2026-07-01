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

  // Dump a single call's structured turns + transcriber/voice config, so we can
  // tell whether Ant GENERATED gibberish (model issue) or the transcript just
  // garbled his audio (STT/voice issue) — e.g. the Hindi-speaker call.
  if (action === 'calldetail') {
    const cid = String(q.call_id || '').trim();
    if (!cid) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'pass &call_id=' }) };
    const got = await vapi('GET', `/call/${cid}`, key);
    if (!got.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, status: got.status, error: got.json }) };
    const c = got.json || {};
    const a = c.assistantOverrides || c.assistant || {};
    const model = (a.model || (c.assistant && c.assistant.model)) || {};
    const argsOf = (m) => {
      const tcs = m.toolCalls || m.tool_calls || (m.toolWithToolCallList) || [];
      const list = Array.isArray(tcs) ? tcs : [];
      const out = list.map((tc) => ({ name: (tc.function && tc.function.name) || tc.name, args: (tc.function && tc.function.arguments) != null ? (tc.function.arguments) : tc.arguments }));
      return out.length ? out : undefined;
    };
    const msgs = (c.messages || (c.artifact && c.artifact.messages) || []).map((m) => ({
      role: m.role, t: (typeof m.secondsFromStart === 'number' ? Math.round(m.secondsFromStart) + 's' : ''), text: String(m.message || m.content || '').slice(0, 300),
      tool_calls: (q.args === '1') ? argsOf(m) : undefined,
    }));
    return { statusCode: 200, body: JSON.stringify({
      ok: true, id: c.id, ended_reason: c.endedReason,
      transcriber: (a.transcriber || (c.assistant && c.assistant.transcriber)) || null,
      voice_provider: ((a.voice || (c.assistant && c.assistant.voice)) || {}).provider || null,
      turns: (q.args === '1') ? msgs.filter((x) => x.tool_calls) : msgs,
    }, null, 2) };
  }

  // Human handoff: there is NO live transfer / no live rep right now. If a caller
  // asks for a person, don't imply a transfer — say so cleanly and take a message.
  if (action === 'human_handoff') {
    const id = '7cc98b0c-54a7-4d19-bd48-6dfac606e55d';
    const got = await vapi('GET', `/assistant/${id}`, key);
    if (!got.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'could not load inbound', status: got.status }) };
    const model = got.json.model || {};
    const msgs = Array.isArray(model.messages) ? model.messages.map((m) => Object.assign({}, m)) : [];
    const si = msgs.findIndex((m) => m.role === 'system');
    if (si < 0) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no system message' }) };
    const MARK = '<!-- HUMAN-HANDOFF -->';
    if (String(msgs[si].content || '').includes(MARK)) return { statusCode: 200, body: JSON.stringify({ ok: true, already: true, assistant: got.json.name }) };
    const BLOCK = `${MARK}\n## NO LIVE TRANSFER — TAKE A MESSAGE (highest priority; overrides any "transfer" instruction)\n`
      + `There is NO live human representative and NO live call transfer available right now. If a caller asks to speak to a person, a representative, a manager, or "a human," do NOT try to transfer and do NOT imply someone is about to pick up. Say it warmly and simply, like: "I'm sorry, we don't have anyone available for a live transfer right now — but I can take care of this for you. Just tell me what you need and I'll record it and get it straight to our office, and someone will reach back out to you as soon as they can." Then capture their name, number, and exactly what they need with capture_callback so the office follows up. Keep it clean and reassuring — never leave them waiting on a transfer that will not happen.\n${MARK}\n\n`;
    msgs[si].content = BLOCK + String(msgs[si].content || '');
    const resp = await vapi('PATCH', `/assistant/${id}`, key, { model: Object.assign({}, model, { messages: msgs }) });
    const verify = await vapi('GET', `/assistant/${id}`, key);
    const sysNow = (((verify.json || {}).model || {}).messages || []).find((m) => m.role === 'system');
    const applied = String((sysNow && sysNow.content) || '').includes(MARK);
    return { statusCode: 200, body: JSON.stringify({ ok: resp.ok && applied, assistant: got.json.name, applied, status: resp.status, error: resp.ok ? null : resp.json }, null, 2) };
  }

  // Date guard: never read back a scheduled date that has already passed as if
  // it is upcoming (Ant told a customer "you're scheduled for June 24" a week
  // after June 24). Idempotent, prepended to Ant Inbound.
  if (action === 'date_guard') {
    const id = '7cc98b0c-54a7-4d19-bd48-6dfac606e55d';
    const got = await vapi('GET', `/assistant/${id}`, key);
    if (!got.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'could not load inbound', status: got.status }) };
    const model = got.json.model || {};
    const msgs = Array.isArray(model.messages) ? model.messages.map((m) => Object.assign({}, m)) : [];
    const si = msgs.findIndex((m) => m.role === 'system');
    if (si < 0) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no system message' }) };
    const MARK = '<!-- DATE-GUARD -->';
    if (String(msgs[si].content || '').includes(MARK)) return { statusCode: 200, body: JSON.stringify({ ok: true, already: true, assistant: got.json.name }) };
    const BLOCK = `${MARK}\n## DATES — NEVER READ BACK A PAST DATE AS UPCOMING (highest priority)\n`
      + `A job's scheduled date can be stale. Each job comes with "scheduled_is_past": if that is true (or the date is clearly before today), the appointment date has ALREADY PASSED — do NOT say "you're scheduled for [that date]." Instead say it looks like that date has passed, and ask whether the visit already happened or if they need to get rescheduled, then help with that. Only present a date as upcoming when it is genuinely in the future. When you do confirm a real upcoming appointment, we schedule by DAY (not a clock time) — say the day and that we text a live arrival window that morning.\n${MARK}\n\n`;
    msgs[si].content = BLOCK + String(msgs[si].content || '');
    const resp = await vapi('PATCH', `/assistant/${id}`, key, { model: Object.assign({}, model, { messages: msgs }) });
    const verify = await vapi('GET', `/assistant/${id}`, key);
    const sysNow = (((verify.json || {}).model || {}).messages || []).find((m) => m.role === 'system');
    const applied = String((sysNow && sysNow.content) || '').includes(MARK);
    return { statusCode: 200, body: JSON.stringify({ ok: resp.ok && applied, assistant: got.json.name, applied, status: resp.status, error: resp.ok ? null : resp.json }, null, 2) };
  }

  // Lookup guidance — from call review (Phil Minge, 7/1): Ant couldn't find a
  // caller and the call died searching. The search is now forgiving (fuzzy +
  // city). Tell Ant to USE it: search name + CITY together, don't demand exact
  // spelling, and take a callback fast instead of grinding.
  if (action === 'lookup_guidance') {
    const id = '7cc98b0c-54a7-4d19-bd48-6dfac606e55d';
    const got = await vapi('GET', `/assistant/${id}`, key);
    if (!got.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'could not load inbound', status: got.status }) };
    const model = got.json.model || {};
    const msgs = Array.isArray(model.messages) ? model.messages.map((m) => Object.assign({}, m)) : [];
    const si = msgs.findIndex((m) => m.role === 'system');
    if (si < 0) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no system message' }) };
    const MARK = '<!-- LOOKUP-GUIDANCE -->';
    if (String(msgs[si].content || '').includes(MARK)) return { statusCode: 200, body: JSON.stringify({ ok: true, already: true, assistant: got.json.name }) };
    const BLOCK = `${MARK}\n## FINDING THEIR ACCOUNT — be resourceful, don't grind (highest priority)\n`
      + `Our customer search is forgiving — it tolerates spelling and mis-hearings and can match on partial names + city. Use it well:\n`
      + `1. If the phone lookup doesn't match (common for warranty customers), ask for their NAME and their CITY, then search with BOTH together (e.g. "Temple Mandeville"). City greatly narrows it and fixes name mis-hears.\n`
      + `2. You do NOT need exact spelling. If you're unsure how a name is spelled, search it anyway with the city — the search is fuzzy. Don't ask them to spell it letter-by-letter more than once.\n`
      + `3. If a claim number returns multiple records, ask for city AND appliance type to narrow — don't just re-read the number.\n`
      + `4. Don't grind. If name+city hasn't found them after a couple tries, STOP searching, apologize once, and take a callback (name + number + what they need) so the office can pull it manually. A quick callback beats a long dead-end search that times out.\n${MARK}\n\n`;
    msgs[si].content = BLOCK + String(msgs[si].content || '');
    const resp = await vapi('PATCH', `/assistant/${id}`, key, { model: Object.assign({}, model, { messages: msgs }) });
    const verify = await vapi('GET', `/assistant/${id}`, key);
    const sysNow = (((verify.json || {}).model || {}).messages || []).find((m) => m.role === 'system');
    const applied = String((sysNow && sysNow.content) || '').includes(MARK);
    return { statusCode: 200, body: JSON.stringify({ ok: resp.ok && applied, assistant: got.json.name, applied, status: resp.status, error: resp.ok ? null : resp.json }, null, 2) };
  }

  // Already-completed warranty repair → the customer must open a RECALL with
  // their warranty company. We CANNOT reschedule / send a tech / promise a
  // callback until that recall is opened. (Teddy 2026-07-01.) Idempotent.
  if (action === 'recall_policy') {
    const id = '7cc98b0c-54a7-4d19-bd48-6dfac606e55d';
    const got = await vapi('GET', `/assistant/${id}`, key);
    if (!got.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'could not load inbound', status: got.status }) };
    const model = got.json.model || {};
    const msgs = Array.isArray(model.messages) ? model.messages.map((m) => Object.assign({}, m)) : [];
    const si = msgs.findIndex((m) => m.role === 'system');
    if (si < 0) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no system message' }) };
    const MARK = '<!-- RECALL-POLICY -->';
    if (String(msgs[si].content || '').includes(MARK)) return { statusCode: 200, body: JSON.stringify({ ok: true, already: true, assistant: got.json.name }) };
    const BLOCK = `${MARK}\n## ALREADY-COMPLETED WARRANTY REPAIR = RECALL THROUGH THEIR WARRANTY COMPANY (hard rule)\n`
      + `If a WARRANTY customer calls saying the SAME appliance still isn't working (or broke again) AFTER we already finished it — i.e. the job you find is marked COMPLETED and has been invoiced/closed — you CANNOT schedule a return visit and you CANNOT promise a callback or a tech. Do NOT say "we'll call you right back" or "we'll get someone out there." That is the wrong answer here and we can't honor it.\n`
      + `Instead, tell them warmly but clearly:\n`
      + `- "I see we already completed that repair and the job is closed on our end."\n`
      + `- "Because it's a warranty job, once it's closed any follow-up has to go back through your warranty company as a RECALL. Please call your warranty company (for example American Home Shield, SquareTrade, or Frontdoor) and open a recall on this claim."\n`
      + `- "The moment they open the recall, they dispatch us back out and we'll come take care of it — but we're not able to send a tech or reschedule until that recall is opened on their side."\n`
      + `Be kind but firm — we genuinely cannot help until the recall is opened with the warranty company. If you know their warranty company from the claim, name it. This applies ONLY to warranty jobs that are already completed/invoiced. Cash / self-pay customers are different — help them directly. And if the original job is NOT completed yet, this rule does not apply — handle it normally.\n${MARK}\n\n`;
    msgs[si].content = BLOCK + String(msgs[si].content || '');
    const resp = await vapi('PATCH', `/assistant/${id}`, key, { model: Object.assign({}, model, { messages: msgs }) });
    const verify = await vapi('GET', `/assistant/${id}`, key);
    const sysNow = (((verify.json || {}).model || {}).messages || []).find((m) => m.role === 'system');
    const applied = String((sysNow && sysNow.content) || '').includes(MARK);
    return { statusCode: 200, body: JSON.stringify({ ok: resp.ok && applied, assistant: got.json.name, applied, status: resp.status, error: resp.ok ? null : resp.json }, null, 2) };
  }

  // Caller-ID first: the customer is calling from their own phone and we've
  // looked them up by it — greet by name, don't demand a work-order/claim number
  // most people don't have. Idempotent, prepended to Ant Inbound.
  if (action === 'phone_first') {
    const id = '7cc98b0c-54a7-4d19-bd48-6dfac606e55d';
    const got = await vapi('GET', `/assistant/${id}`, key);
    if (!got.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'could not load inbound', status: got.status }) };
    const model = got.json.model || {};
    const msgs = Array.isArray(model.messages) ? model.messages.map((m) => Object.assign({}, m)) : [];
    const si = msgs.findIndex((m) => m.role === 'system');
    if (si < 0) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no system message' }) };
    const MARK = '<!-- PHONE-FIRST -->';
    if (String(msgs[si].content || '').includes(MARK)) return { statusCode: 200, body: JSON.stringify({ ok: true, already: true, assistant: got.json.name }) };
    const BLOCK = `${MARK}\n## CALLER ID — YOU ALREADY KNOW WHO THEY ARE (highest priority)\n`
      + `The customer is calling from their OWN phone, and you look them up by that number automatically at the start of the call. As soon as you've matched them, greet them by NAME. Do NOT ask a homeowner for a claim, work-order, or dispatch number as your first move — most people don't have it in front of them and it makes us look like we don't know them. Instead, confirm who they are and ask what appliance or issue they're calling about, and find their job from their account (their recent jobs, even a canceled/completed one). Only ask for a claim number as a LAST resort, if you truly can't find them by phone OR name. (Warranty-company CSC reps ARE expected to have a claim/dispatch number — that's a different caller; this rule is for homeowners.)\n${MARK}\n\n`;
    msgs[si].content = BLOCK + String(msgs[si].content || '');
    const resp = await vapi('PATCH', `/assistant/${id}`, key, { model: Object.assign({}, model, { messages: msgs }) });
    const verify = await vapi('GET', `/assistant/${id}`, key);
    const sysNow = (((verify.json || {}).model || {}).messages || []).find((m) => m.role === 'system');
    const applied = String((sysNow && sysNow.content) || '').includes(MARK);
    return { statusCode: 200, body: JSON.stringify({ ok: resp.ok && applied, assistant: got.json.name, applied, status: resp.status, error: resp.ok ? null : resp.json }, null, 2) };
  }

  // Tighten Ant INBOUND (customer line) for VOICE: kill the repeated "one
  // moment / let me pull that up" stalls that drive the silence-timeouts, keep
  // it warm + short, handle "I want a person" without looping, and NEVER babble
  // when a caller has an accent / speaks another language (the gibberish bug).
  if (action === 'tighten_inbound') {
    const id = '7cc98b0c-54a7-4d19-bd48-6dfac606e55d';
    const got = await vapi('GET', `/assistant/${id}`, key);
    if (!got.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'could not load inbound', status: got.status, detail: got.json }) };
    const model = got.json.model || {};
    const msgs = Array.isArray(model.messages) ? model.messages.map((m) => Object.assign({}, m)) : [];
    const si = msgs.findIndex((m) => m.role === 'system');
    if (si < 0) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no system message' }) };
    const MARK = '<!-- VOICE-DELIVERY-CX -->';
    let promptChanged = false;
    if (!String(msgs[si].content || '').includes(MARK)) {
      const BLOCK = `${MARK}\n## 🎙️ VOICE DELIVERY — HIGHEST PRIORITY (live call with a customer; overrides anything below)\n`
        + `Be warm, quick, and human. Hard rules:\n`
        + `1. NEVER repeat "one moment" or "let me pull that up." Say a short "let me check" ONCE while you look, then give the answer. Never say the same filler two turns in a row, and never leave dead air — if a lookup runs long, stay with them ("still pulling it up, hang with me one sec").\n`
        + `2. Keep every turn to a sentence or two. One question at a time. Don't over-explain.\n`
        + `3. If they ask for a person/representative, DON'T loop them with fillers — connect/transfer per your rules, or immediately offer to take their name + number for a fast callback. Help on the first ask.\n`
        + `4. LANGUAGE: if the caller has a heavy accent, speaks another language, or you're not sure what they said, SLOW DOWN and keep it simple. NEVER speak nonsense or made-up words. If you didn't understand, say "I want to get this right — can you say that once more?" or offer a callback from someone who can help. Babbling loses the customer.\n`
        + `5. Read names, claim numbers, and dates back once to confirm — accurately — then move on.\n${MARK}\n\n`;
      msgs[si].content = BLOCK + String(msgs[si].content || '');
      promptChanged = true;
    }
    const tools = Array.isArray(model.tools) ? model.tools : [];
    let fillersFixed = 0;
    const newTools = tools.map((t) => {
      if (t.type !== 'function' || !Array.isArray(t.messages)) return t;
      const msgs2 = t.messages.map((m) => (m.type === 'request-start' ? { type: 'request-start', content: 'Let me check…' } : m));
      if (JSON.stringify(msgs2) !== JSON.stringify(t.messages)) fillersFixed++;
      return Object.assign({}, t, { messages: msgs2 });
    });
    if (!promptChanged && !fillersFixed) return { statusCode: 200, body: JSON.stringify({ ok: true, already: true, assistant: got.json.name }) };
    const resp = await vapi('PATCH', `/assistant/${id}`, key, { model: Object.assign({}, model, { messages: msgs, tools: newTools }) });
    const verify = await vapi('GET', `/assistant/${id}`, key);
    const sysNow = (((verify.json || {}).model || {}).messages || []).find((m) => m.role === 'system');
    const applied = String((sysNow && sysNow.content) || '').includes(MARK);
    return { statusCode: 200, body: JSON.stringify({ ok: resp.ok && applied, assistant: got.json.name, voice_rules_applied: applied, fillers_softened: fillersFixed, status: resp.status, error: resp.ok ? null : resp.json }, null, 2) };
  }

  // Fix the tech-interview assistant "pausing a lot" (Jimmy, 7/1: she pauses,
  // he has to bring her back). Causes found: nova-3/"multi" transcriber (slow
  // endpointing), no latency/interrupt tuning, no filler on save_tech_profile
  // (dead air during saves), and long monologues. This makes her snappy + short.
  // ?action=smooth_interview[&id=<assistant>]  (defaults to Ant — Tech Setup)
  if (action === 'smooth_interview') {
    const id = String(q.id || 'ec2be4b8-c1c4-4c68-a7ea-d44f7d63a3e6').trim();
    const got = await vapi('GET', `/assistant/${id}`, key);
    if (!got.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'could not load assistant', status: got.status }) };
    const a2 = got.json || {};
    const model = a2.model || {};
    const msgs = Array.isArray(model.messages) ? model.messages.map((m) => Object.assign({}, m)) : [];
    const si = msgs.findIndex((m) => m.role === 'system');
    if (si < 0) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no system message' }) };
    const MARK = '<!-- SMOOTH-INTERVIEW -->';
    let promptChanged = false;
    if (!String(msgs[si].content || '').includes(MARK)) {
      const BLOCK = `${MARK}\n## 🎙️ KEEP IT SNAPPY — HIGHEST PRIORITY (live phone call; overrides anything below about read-backs or walkthroughs)\n`
        + `1. SHORT turns. One or two sentences, then STOP and let him talk. Ask ONE thing at a time. Long turns leave dead air and make it feel like the call froze.\n`
        + `2. NO long monologues. Do NOT recite the whole capabilities list or a full profile read-back in one breath. If you recap, keep it to a quick line ("So — 8 to 6, off weekends, Murfreesboro-to-Antioch, that right?"), not a paragraph.\n`
        + `3. NEVER go silent. If you need a moment to save or think, SAY a quick "one sec" and keep it moving — dead air makes him think you glitched and start talking to get you back.\n`
        + `4. When you save, say something short like "locking that in" out loud, then continue — never a silent pause.\n${MARK}\n\n`;
      msgs[si].content = BLOCK + String(msgs[si].content || '');
      promptChanged = true;
    }
    // Add a spoken filler to the save tool so saves aren't dead air.
    const tools = Array.isArray(model.tools) ? model.tools : [];
    let toolFixed = 0;
    const newTools = tools.map((t) => {
      if (t.type !== 'function') return t;
      const nm = (t.function && t.function.name) || t.name;
      if (nm !== 'save_tech_profile') return t;
      const hasStart = Array.isArray(t.messages) && t.messages.some((m) => m.type === 'request-start');
      if (hasStart) return t;
      toolFixed++;
      return Object.assign({}, t, { messages: [{ type: 'request-start', content: 'One sec — locking that in.' }] });
    });
    const patch = {
      model: Object.assign({}, model, { messages: msgs, tools: newTools }),
      transcriber: { provider: 'deepgram', model: 'nova-2-phonecall', language: 'en-US' },
      responseDelaySeconds: 0.2,
      numWordsToInterruptAssistant: 2,
      startSpeakingPlan: { waitSeconds: 0.3 },
    };
    const resp = await vapi('PATCH', `/assistant/${id}`, key, patch);
    const verify = await vapi('GET', `/assistant/${id}`, key);
    const vj = verify.json || {};
    const sysNow = ((vj.model || {}).messages || []).find((m) => m.role === 'system');
    const promptApplied = String((sysNow && sysNow.content) || '').includes(MARK);
    const trNow = vj.transcriber || {};
    return { statusCode: 200, body: JSON.stringify({ ok: resp.ok && promptApplied, assistant: a2.name, prompt_applied: promptApplied, save_filler_added: toolFixed, transcriber_now: { model: trNow.model, language: trNow.language }, responseDelaySeconds: vj.responseDelaySeconds, status: resp.status, error: resp.ok ? null : resp.json }, null, 2) };
  }

  // Second voice pass on Ant Inbound, from real call review (Marcel, 7/1):
  //  (a) "Let me check" was firing over and over — the per-tool request-start
  //      filler plays once PER tool call, so chained lookups stacked it 3-5x
  //      of dead-airy repetition. Strip those per-tool fillers + add an
  //      anti-repetition rule (the prompt already forbids true dead air).
  //  (b) Date read-back bug — Ant called TODAY "tomorrow" ("scheduled with
  //      John for tomorrow, July 1" on July 1). Force absolute calendar
  //      phrasing; ban guessed relative words.
  if (action === 'voice_polish2') {
    const id = '7cc98b0c-54a7-4d19-bd48-6dfac606e55d';
    const got = await vapi('GET', `/assistant/${id}`, key);
    if (!got.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'could not load inbound', status: got.status }) };
    const model = got.json.model || {};
    const msgs = Array.isArray(model.messages) ? model.messages.map((m) => Object.assign({}, m)) : [];
    const si = msgs.findIndex((m) => m.role === 'system');
    if (si < 0) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no system message' }) };
    const MARK = '<!-- VOICE-POLISH-2 -->';
    let promptChanged = false;
    if (!String(msgs[si].content || '').includes(MARK)) {
      const BLOCK = `${MARK}\n## 🎙️ VOICE POLISH — HIGHEST PRIORITY (live customer call; overrides anything below)\n`
        + `1. DON'T repeat a filler. Say "let me check" (or similar) AT MOST once, then stop with the filler and just give the answer. Never say "let me check" two turns in a row, and never stack it while looking up several things — to the caller it should feel like ONE quick check, not five. If a lookup genuinely runs long, say something real ("still pulling your job up, one sec"), not the same filler again.\n`
        + `2. DATES — say the ACTUAL calendar day, never a guessed relative word. State an appointment as the weekday + month + day (e.g. "Wednesday, July 1"). Do NOT say "today," "tomorrow," or "yesterday" unless you are certain of the real current date — when unsure, just say the calendar date. NEVER call a date "tomorrow" unless it is literally the day after today. If you're not sure whether a date is upcoming or already passed, ask the caller instead of guessing.\n${MARK}\n\n`;
      msgs[si].content = BLOCK + String(msgs[si].content || '');
      promptChanged = true;
    }
    // Strip the per-tool request-start fillers so they stop stacking on chained
    // lookups. The prompt (VOICE-DELIVERY-CX + this block) forbids real dead air,
    // and one model-spoken "let me check" reads far better than a robotic string
    // replayed once per tool call.
    const tools = Array.isArray(model.tools) ? model.tools : [];
    let fillersRemoved = 0;
    const newTools = tools.map((t) => {
      if (t.type !== 'function' || !Array.isArray(t.messages)) return t;
      const kept = t.messages.filter((m) => m.type !== 'request-start');
      if (kept.length !== t.messages.length) fillersRemoved++;
      return Object.assign({}, t, { messages: kept });
    });
    if (!promptChanged && !fillersRemoved) return { statusCode: 200, body: JSON.stringify({ ok: true, already: true, assistant: got.json.name }) };
    const resp = await vapi('PATCH', `/assistant/${id}`, key, { model: Object.assign({}, model, { messages: msgs, tools: newTools }) });
    const verify = await vapi('GET', `/assistant/${id}`, key);
    const sysNow = (((verify.json || {}).model || {}).messages || []).find((m) => m.role === 'system');
    const applied = String((sysNow && sysNow.content) || '').includes(MARK);
    return { statusCode: 200, body: JSON.stringify({ ok: resp.ok && applied, assistant: got.json.name, applied, per_tool_fillers_removed: fillersRemoved, status: resp.status, error: resp.ok ? null : resp.json }, null, 2) };
  }

  // From call review (7/1): (a) endCall is OFF, so completed calls linger in
  // silence until they time out — inflating "silence-timeout" with successful
  // calls that just never hung up (e.g. Daniel Wang's flawless intake). Enable
  // endCall + end phrases. (b) Ant still sometimes PROMISES a transfer it can't
  // do ("let me get you to the office") then dead-airs — there IS no transfer
  // tool. Ban those phrases; go straight to take-a-message.
  if (action === 'endcall_notransfer') {
    const id = '7cc98b0c-54a7-4d19-bd48-6dfac606e55d';
    const got = await vapi('GET', `/assistant/${id}`, key);
    if (!got.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'could not load inbound', status: got.status }) };
    const model = got.json.model || {};
    const msgs = Array.isArray(model.messages) ? model.messages.map((m) => Object.assign({}, m)) : [];
    const si = msgs.findIndex((m) => m.role === 'system');
    if (si < 0) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no system message' }) };
    const MARK = '<!-- ENDCALL-NOTRANSFER -->';
    let promptChanged = false;
    if (!String(msgs[si].content || '').includes(MARK)) {
      const BLOCK = `${MARK}\n## HANG UP WHEN DONE · NO TRANSFERS (highest priority; overrides anything below)\n`
        + `1. There is NO live transfer and NO transfer tool. NEVER say "let me get you to the office," "let me transfer you," "connecting you," "let me get someone on the line," or anything that implies a handoff — you cannot do it and the caller drops into dead air. If they want a person: immediately take their name + best callback number and log it with capture_callback — "we don't have anyone for a live transfer right now, but give me your name and number and I'll have the office call you right back."\n`
        + `2. END THE CALL when you're done. Once you've helped them (or logged a callback), give a short goodbye ("have a good day" / "talk to you soon") and HANG UP. Do NOT sit in silence after the goodbye — a lingering call dies on a timeout. If the caller goes quiet mid-call, check in once ("you still there?"); if still nothing, wrap up and end the call.\n${MARK}\n\n`;
      msgs[si].content = BLOCK + String(msgs[si].content || '');
      promptChanged = true;
    }
    const endPhrases = ['have a good day', 'have a great day', 'talk to you soon', 'take care', 'goodbye', 'bye now', 'thanks for calling us'];
    const patch = { model: Object.assign({}, model, { messages: msgs }), endCallFunctionEnabled: true, endCallPhrases: endPhrases };
    const resp = await vapi('PATCH', `/assistant/${id}`, key, patch);
    const verify = await vapi('GET', `/assistant/${id}`, key);
    const vj = verify.json || {};
    const sysNow = ((vj.model || {}).messages || []).find((m) => m.role === 'system');
    const promptApplied = String((sysNow && sysNow.content) || '').includes(MARK);
    const endcallApplied = vj.endCallFunctionEnabled === true && Array.isArray(vj.endCallPhrases) && vj.endCallPhrases.length > 0;
    return { statusCode: 200, body: JSON.stringify({ ok: resp.ok && promptApplied && endcallApplied, assistant: got.json.name, no_transfer_prompt: promptApplied, endcall_enabled: endcallApplied, end_phrases: vj.endCallPhrases, status: resp.status, error: resp.ok ? null : resp.json }, null, 2) };
  }

  // Lee's rule: at wrap-up, ask the tech for any parts he brought but didn't
  // need, so the office can return/restock them (warranty returns + inventory).
  // Idempotent, prepended to Ant Field Assist.
  if (action === 'unused_parts') {
    const id = String(q.assistant_id || 'a22edcd1-495a-4d77-a66a-fb167997c70a').trim();
    const got = await vapi('GET', `/assistant/${id}`, key);
    if (!got.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'could not load assistant', status: got.status }) };
    const model = got.json.model || {};
    const msgs = Array.isArray(model.messages) ? model.messages.map((m) => Object.assign({}, m)) : [];
    const si = msgs.findIndex((m) => m.role === 'system');
    if (si < 0) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no system message' }) };
    const MARK = '<!-- UNUSED-PARTS -->';
    if (String(msgs[si].content || '').includes(MARK)) return { statusCode: 200, body: JSON.stringify({ ok: true, already: true, assistant: got.json.name }) };
    const BLOCK = `${MARK}\n## WRAP-UP — ASK FOR PARTS NOT NEEDED (Lee's rule)\n`
      + `Before you finish the report, ask the tech ONE quick question: "Any parts you brought but didn't end up needing? Give me those part numbers so the office can get them returned or back on the shelf." Capture the part numbers he gives and put them in the report clearly marked as RETURN / not used, so the office processes them — this matters for warranty part returns and inventory. If he says none, move on; don't push.\n${MARK}\n\n`;
    msgs[si].content = BLOCK + String(msgs[si].content || '');
    const resp = await vapi('PATCH', `/assistant/${id}`, key, { model: Object.assign({}, model, { messages: msgs }) });
    const verify = await vapi('GET', `/assistant/${id}`, key);
    const sysNow = (((verify.json || {}).model || {}).messages || []).find((m) => m.role === 'system');
    const applied = String((sysNow && sysNow.content) || '').includes(MARK);
    return { statusCode: 200, body: JSON.stringify({ ok: resp.ok && applied, assistant: got.json.name, applied, status: resp.status, error: resp.ok ? null : resp.json }, null, 2) };
  }

  // Tighten Ant Field Assist for VOICE: stop reciting option-lists, stop
  // stalling, keep turns short, get names/numbers right, pull part #s live.
  // Prepends a highest-priority block (idempotent) so it wins over the long
  // prompt below. Also softens the tool "one moment" filler that added dead air.
  if (action === 'tighten_field') {
    const id = String(q.assistant_id || 'a22edcd1-495a-4d77-a66a-fb167997c70a').trim();
    const got = await vapi('GET', `/assistant/${id}`, key);
    if (!got.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'could not load assistant', status: got.status, detail: got.json }) };
    const model = got.json.model || {};
    const msgs = Array.isArray(model.messages) ? model.messages.map((m) => Object.assign({}, m)) : [];
    const si = msgs.findIndex((m) => m.role === 'system');
    if (si < 0) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no system message' }) };
    const MARK = '<!-- VOICE-DELIVERY -->';
    let promptChanged = false;
    if (!String(msgs[si].content || '').includes(MARK)) {
      const BLOCK = `${MARK}\n## 🎙️ VOICE DELIVERY — HIGHEST PRIORITY (this is a phone call; it overrides anything below about listing or confirming things)\n`
        + `The tech is busy, hands full, customer watching. Talk like a sharp senior tech who respects his time.\n`
        + `1. NEVER read a list of choices out loud. To capture the failure cause, INFER the most likely one from what he said and confirm in ONE short line — "Sounds like normal wear, that right?" If he says no, ask "what caused it then?" Never recite the menu of options.\n`
        + `2. NO STALLING. Never say "one moment," "hold on," or "give me a sec," and never go silent. If you must look something up, say what you're doing in a few words and keep going — then give the answer.\n`
        + `3. ONE question at a time. Keep every turn to a sentence or two — long turns get cut off and waste his time.\n`
        + `4. Use his NAME from the job context and don't rename him mid-call.\n`
        + `5. Numbers: labor is in HOURS ("point five" = 0.5 hours, not dollars). Read a model number back ONCE to confirm, then move on.\n`
        + `6. PART NUMBERS — do it LIVE. When he gives a model + the failed part, look it up right then and text him the parts link with the model loaded. Don't punt the part number to the office unless the lookup truly fails.\n`
        + `7. If he sounds rushed ("I gotta go"), wrap up immediately — confirm what you've got and let him go.\n${MARK}\n\n`;
      msgs[si].content = BLOCK + String(msgs[si].content || '');
      promptChanged = true;
    }
    // Soften the tool request-start filler ("One moment…") that added dead air —
    // shorter + less robotic, only where a filler already exists.
    const tools = Array.isArray(model.tools) ? model.tools : [];
    let fillersFixed = 0;
    const newTools = tools.map((t) => {
      if (t.type !== 'function' || !Array.isArray(t.messages)) return t;
      const msgs2 = t.messages.map((m) => (m.type === 'request-start' ? { type: 'request-start', content: 'Checking…' } : m));
      if (JSON.stringify(msgs2) !== JSON.stringify(t.messages)) fillersFixed++;
      return Object.assign({}, t, { messages: msgs2 });
    });
    if (!promptChanged && !fillersFixed) return { statusCode: 200, body: JSON.stringify({ ok: true, already: true, assistant: got.json.name }) };
    const resp = await vapi('PATCH', `/assistant/${id}`, key, { model: Object.assign({}, model, { messages: msgs, tools: newTools }) });
    const verify = await vapi('GET', `/assistant/${id}`, key);
    const sysNow = (((verify.json || {}).model || {}).messages || []).find((m) => m.role === 'system');
    const applied = String((sysNow && sysNow.content) || '').includes(MARK);
    return { statusCode: 200, body: JSON.stringify({ ok: resp.ok && applied, assistant: got.json.name, voice_rules_applied: applied, fillers_softened: fillersFixed, status: resp.status, error: resp.ok ? null : resp.json }, null, 2) };
  }

  // Inject the appliance-boundary rule into a tech diagnostic assistant's system
  // prompt (idempotent). Default = Ant Field Assist. Belt-and-suspenders for the
  // "Ant told the washer it has a compressor" fix — enforced at the assistant
  // level too, not only inside the diagnose_appliance tool.
  if (action === 'guard_appliance') {
    const id = String(q.assistant_id || 'a22edcd1-495a-4d77-a66a-fb167997c70a').trim();
    const got = await vapi('GET', `/assistant/${id}`, key);
    if (!got.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'could not load assistant', status: got.status, detail: got.json }) };
    const model = got.json.model || {};
    const msgs = Array.isArray(model.messages) ? model.messages.map((m) => Object.assign({}, m)) : [];
    const si = msgs.findIndex((m) => m.role === 'system');
    if (si < 0) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no system message on this assistant' }) };
    const MARK = '<!-- APPLIANCE-GUARD -->';
    if (String(msgs[si].content || '').includes(MARK)) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, already: true, assistant: got.json.name }) };
    }
    const BLOCK = `\n\n${MARK}\n## STAY IN BOUNDS — fit the appliance you're on (hard rule)\n`
      + `Everything you tell the tech must fit the appliance in front of him. A washer, dryer, dishwasher, oven/range, or microwave has NO compressor, refrigerant, sealed system, condenser, or evaporator — NEVER name those unless the unit is a refrigerator, freezer, or ice maker. If a diagnostic tool or a past job comes back about a DIFFERENT appliance, ignore it — never put a wrong-appliance part on the job. Telling a tech his washer has a compressor instantly kills his trust. If the symptom is unclear, ask ONE quick question instead of guessing.\n${MARK}`;
    msgs[si].content = String(msgs[si].content || '') + BLOCK;
    const resp = await vapi('PATCH', `/assistant/${id}`, key, { model: Object.assign({}, model, { messages: msgs }) });
    const verify = await vapi('GET', `/assistant/${id}`, key);
    const sysNow = (((verify.json || {}).model || {}).messages || []).find((m) => m.role === 'system');
    const nowHas = String((sysNow && sysNow.content) || '').includes(MARK);
    return { statusCode: 200, body: JSON.stringify({ ok: resp.ok && nowHas, assistant: got.json.name, applied: nowHas, status: resp.status, error: resp.ok ? null : resp.json }, null, 2) };
  }

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

  // Create (or &update_id=) the outbound "Ant — Tech Setup" interview assistant.
  // She calls each tech, interviews him about how he wants to work, builds his
  // profile (save_tech_profile tool → tech-interview-tool), AND opens the ongoing
  // relationship: tell her if you want more work any day; if you're running behind
  // she'll notify the next customers + help. Copies inbound voice so "she" sounds
  // like Ant.   ?action=setup_tech_interview[&update_id=<id>]
  if (action === 'setup_tech_interview') {
    const INBOUND_ID = '7cc98b0c-54a7-4d19-bd48-6dfac606e55d';
    const inb = (await vapi('GET', `/assistant/${INBOUND_ID}`, key)).json || {};
    const PROMPT = [
      "You are Ant's scheduling assistant for TN Appliance Exchange, calling one of our technicians, {{tech_first_name}} (technician id {{technician_id}}). Your WHOLE purpose is to help this tech be SUCCESSFUL and HAPPY — to build his days around his real life and what he wants, so work feels good and he runs his days with pride. Have a warm, genuine, IN-DEPTH conversation. Talk like a teammate who's on his side, not a survey. Let him talk; follow up naturally.",
      "Make sure he hears — more than once, and genuinely — that you are HAPPY to help him and you're here to make his life and his job EASIER. The feeling underneath the whole call: 'You focus on doing great work and getting jobs completed — I'll handle the schedule, the customers, and the headaches for you.' He should hang up feeling like someone's finally in his corner.",
      "",
      "⏱️ SAVE AS YOU GO — THIS IS CRITICAL. The call can get cut off, so do NOT wait until the end to save. The MOMENT you have the core fields (start/end hours, recurring days off, max stops, the areas he wants and the areas he avoids), CALL save_tech_profile with technician_id {{technician_id}} and what you have so far. Then keep going — last stop, strengths, the capabilities walkthrough, the practice — and CALL save_tech_profile AGAIN at the read-back with the complete profile. Calling it multiple times is expected and good; the latest call wins. NEVER end the call without having called save_tech_profile at least once.",
      "",
      "Cover all of this (conversationally, in any order):",
      "1. Hours: what time he likes to START, how early is too early, and how late he's good to work.",
      "2. A good day: how many stops feels like a solid full day, and what's just too many. Packed pace or steady?",
      "3. Days off he needs on the REGULAR — and the reason (e.g. Tuesdays off because his wife is off). These are hard — we always protect them.",
      "4. Anything to work around: kids, school pickup, lunch, standing commitments.",
      "5. AREAS — get the full picture: ALL the areas/towns he WANTS to work in, and ALL the areas he does NOT want to work in. Also his home base and how far he'll drive on a normal day.",
      "6. LAST STOP of the day: where does he want his LAST job to land — and WHY does that matter to him? (ending close to home, near his kid's school for pickup, near the gym, on his way to something — whatever it is). We'll do our best to make his final stop land there. This is important to him, so dig in.",
      "7. Machines/brands he's strongest on, and any he'd rather hand off.",
      "8. Saturdays — never, sometimes, or only if it's worth it.",
      "9. What makes a day GREAT for him, and what makes one frustrating.",
      "",
      "ALSO tell him these things, warmly — this is about being on his side every day, not just today:",
      "- 'Any day you want MORE work, just tell me and I'll fill your day up.' Ask if he generally wants to be kept busy.",
      "- 'And I can ADJUST your schedule as the day goes on — if something runs long or short, or you finish early, just tell me and I'll re-shuffle it on the fly.'",
      "- 'Want me to let you know when today's callers pop up in YOUR area? If a job comes in near you, I can slot it into your day so you grab it while you're right there — just say the word and I'll make it happen.' Ask if he wants those nearby-job pings.",
      "- 'And if you're ever running behind, let me know — I'll text your next customers a heads-up and help you sort it out, so you're never sweating it alone.'",
      "- Reassure him plainly: 'I'm genuinely happy to do this — my whole job is to make YOUR days easier. You stay focused on getting the jobs done great, and I'll take care of the rest.'",
      "- A personal note from the owner: 'Teddy wanted me to tell you himself — he's going to do everything he possibly can to help you be successful. That's what all of this is for.'",
      "",
      "SHOW HIM YOUR CAPABILITIES — and challenge him to use them. He should come away understanding you're his FULL AI appliance-tech assistant, not just a scheduler — the ultimate tech sidekick. Walk him through it like a teammate handing him a superpower:",
      "  • 'Any day you want MORE WORK, just ask and I'll fill your day.'",
      "  • 'I adjust your schedule on the fly — run long, finish early, whatever — tell me and I reshuffle it.'",
      "  • 'I'll ping you when a job pops up near you so you can grab it while you're right there.'",
      "  • 'Running behind? I text your next customers and smooth it over, so you're never the bad guy.'",
      "  • THE BIG ONE — when he's STUCK or in trouble on a job: 'Get me on the phone or text me right there from the house and I'll pull up the model, the fault codes, what WE'VE fixed on that exact machine before, any recalls, and the right part. You are never out there alone.' Tell him where: tap Ask Ant on his job page, or just call or text me anytime.",
      "  • 'Need a part? Tell me the machine and what's wrong — I'll find the exact part and get it to you or ship it to the customer. You never hunt for a part number.'",
      "  Then CHALLENGE him warmly and get a real yes: 'Here's what I want from you — actually lean on me, hard. The techs who use me have easier days and make more money. Don't tough it out alone — use me for everything. Deal?'",
      "",
      "PRACTICE — do this near the end, it's important. Walk him hands-on through the two requests he'll use most, so he KNOWS how easy it is and where to do it:",
      "  • MORE WORK: 'Let's practice real quick — say it out loud like you would any day: tell me you want more work tomorrow.' Let him say it, then: 'That's it — that easy. Any day you want a fuller day, just tell me and I'll fill it up.'",
      "  • DAY OFF: 'Now practice asking for a day off — tell me a day you'd want off.' Let him say it: 'Perfect, that's exactly how — just say the word and it's handled, no guilt, no hassle.' If he names a REAL day he actually wants off, OFFER to set it for real right now ('want me to go ahead and put you down for that?') — only if he says yes; capture it in days_off.",
      "  • WHERE TO FIND IT: make sure he knows he can do this ANYTIME, three ways — 'just text me right here at this number, or open the scheduling page I'm sending you, or call me and ask. I'm always on.' Don't end the call until he knows where to go.",
      "",
      "This profile is important — it's how every one of his days gets built, so don't rush past the key details (hours, hard days off + why, max stops, areas he wants/avoids, last-stop + why). Gently make sure you actually have them before the read-back; if one's missing, circle back and ask.",
      "Then read his profile back to confirm ('So I've got you: start at 8, off Tuesdays for family, Murfreesboro area, strong on Samsung and LG, max 6 stops — that right?'). When he confirms, call save_tech_profile AGAIN with technician_id {{technician_id}} and the COMPLETE profile (you already saved a partial earlier — this final call captures everything). Thank him and let him know his days will now be built around this.",
      "",
      "Rules: keep it real and not too long. He's a busy tech. If he can't talk now, offer to call back and end politely. Never discuss customer diagnoses, parts, or pricing — this call is only about HIM and how he works. Always include technician_id {{technician_id}} when you save.",
    ].join('\n');
    const tool = {
      type: 'function',
      function: {
        name: 'save_tech_profile',
        description: "Save the technician's work-style + life profile so we build his schedule around it. Call once he's confirmed the read-back.",
        parameters: {
          type: 'object',
          properties: {
            technician_id: { type: 'string', description: 'The tech id (provided in call variables as technician_id).' },
            tech_first_name: { type: 'string' },
            start_earliest: { type: 'string', description: 'Earliest he will start (e.g. "8am").' },
            start_ideal: { type: 'string' },
            end_latest: { type: 'string', description: 'Latest he will work.' },
            stops_good: { type: 'string', description: 'Comfortable stops per day.' },
            stops_max: { type: 'string', description: 'Absolute max stops per day.' },
            pace: { type: 'string', description: 'packed or steady.' },
            days_off_hard: { type: 'string', description: 'Recurring HARD days off, comma-separated (e.g. "Tue").' },
            days_off_reason: { type: 'string' },
            day_prefs_soft: { type: 'string', description: 'Soft day preferences.' },
            weekends: { type: 'string', description: 'never | sometimes | yes.' },
            life_windows: { type: 'string', description: 'Kids/school/lunch/commitments to work around.' },
            home_base: { type: 'string' },
            areas_pref: { type: 'string', description: 'ALL areas/towns he WANTS to work, comma-separated.' },
            drive_radius_mi: { type: 'string', description: 'How far he will drive (miles).' },
            areas_avoid: { type: 'string', description: 'ALL areas he does NOT want to work, comma-separated.' },
            last_stop_where: { type: 'string', description: 'Where he wants his LAST stop of the day to land (area/town/landmark).' },
            last_stop_why: { type: 'string', description: 'WHY the last-stop location matters to him (e.g. close to home, kid pickup).' },
            appliance_strong: { type: 'string', description: 'Strong appliances/brands, comma-separated.' },
            appliance_avoid: { type: 'string', description: 'Appliances/brands to hand off, comma-separated.' },
            weekends_note: { type: 'string' },
            wants_more_work: { type: 'string', description: 'yes if he generally wants to be kept busy / take extra stops.' },
            wants_area_pings: { type: 'string', description: 'yes if he wants to be pinged when same-day jobs come up in his area.' },
            great_day: { type: 'string', description: 'What makes a day great for him.' },
            frustrating: { type: 'string', description: 'What makes a day frustrating.' },
            notes: { type: 'string' },
          },
          required: ['technician_id'],
        },
      },
      server: { url: 'https://tnapplianceexchange.net/.netlify/functions/tech-interview-tool' },
    };
    const body = {
      name: 'Ant — Tech Setup',
      maxDurationSeconds: 900,
      firstMessage: "Hey {{tech_first_name}}, it's Ant from T-N Appliance — got a few minutes? I'm happy to help, and honestly my whole job is to make your days easier. I want to set your schedule up around how YOU like to work so your days fit your life — you just focus on the jobs, I'll handle the rest. Cool if I ask you a few things?",
      model: {
        provider: (inb.model && inb.model.provider) || 'anthropic',
        model: (inb.model && inb.model.model) || 'claude-sonnet-4-5-20250929',
        messages: [{ role: 'system', content: PROMPT }],
        tools: [tool],
      },
    };
    if (inb.voice) body.voice = inb.voice;
    if (inb.transcriber) body.transcriber = inb.transcriber;
    body.backgroundSound = inb.backgroundSound || 'off';
    const res = q.update_id
      ? await vapi('PATCH', `/assistant/${q.update_id}`, key, body)
      : await vapi('POST', '/assistant', key, body);
    return { statusCode: 200, body: JSON.stringify({ ok: res.ok, status: res.status, assistant_id: res.json && res.json.id, name: res.json && res.json.name, prompt_len: PROMPT.length, has_practice: PROMPT.includes('PRACTICE'), save_as_you_go: PROMPT.includes('SAVE AS YOU GO'), max_dur: (res.json && res.json.maxDurationSeconds) || body.maxDurationSeconds, error: res.ok ? null : res.json }, null, 2) };
  }

  // Place the tech-interview call. ?action=interview_call&to=+1...&assistant_id=<id>
  //   &tech_id=2&tech_first=Jimmy [&from_id=]
  if (action === 'interview_call') {
    const to = String(q.to || '').trim();
    const assistantId = String(q.assistant_id || '').trim();
    if (!to || !assistantId) return { statusCode: 400, body: JSON.stringify({ ok: false, error: '?to= and ?assistant_id= required' }) };
    const fromId = String(q.from_id || 'd57d5cf2-60a7-46e6-a7f0-24ed652c1f31').trim();
    const callBody = {
      assistantId, phoneNumberId: fromId, customer: { number: to },
      assistantOverrides: { variableValues: { tech_first_name: q.tech_first || 'there', technician_id: String(q.tech_id || '0') } },
    };
    const res = await vapi('POST', '/call', key, callBody);
    return { statusCode: 200, body: JSON.stringify({ ok: res.ok, status: res.status, call_id: res.json && res.json.id, to, tech_id: q.tech_id, error: res.ok ? null : res.json }, null, 2) };
  }

  // Raise/lower an assistant's max call length so a thorough interview doesn't
  // get cut off. ?action=setmaxdur&id=<assistantId>&seconds=1500
  if (action === 'setmaxdur') {
    const id = String(q.id || '').trim();
    if (!id) return { statusCode: 400, body: JSON.stringify({ ok: false, error: '?id=<assistantId> required' }) };
    const seconds = Math.max(60, Math.min(7200, parseInt(q.seconds, 10) || 1500));
    const res = await vapi('PATCH', `/assistant/${id}`, key, { maxDurationSeconds: seconds });
    return { statusCode: 200, body: JSON.stringify({ ok: res.ok, status: res.status, id, maxDurationSeconds: (res.json && res.json.maxDurationSeconds) || seconds, error: res.ok ? null : res.json }) };
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

  // Full config of one phone number (provider, credential, fallback) — to debug
  // why transfers fail. &num=+16152802949 (default the main line).
  if (action === 'phonefull') {
    const want = (q.num || '+16152802949').replace(/[^\d+]/g, '');
    const phones = listFrom(await vapi('GET', '/phone-number?limit=100', key));
    const p = phones.find((x) => (x.number || '').replace(/[^\d+]/g, '') === want);
    if (!p) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'number not found', have: phones.map((x) => x.number) }) };
    const full = await vapi('GET', `/phone-number/${p.id}`, key);
    return { statusCode: 200, body: JSON.stringify({ ok: true, phone: full.json }, null, 2) };
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

  // Target assistant: default = Ant Inbound, OR &assistant_id=<id> to inspect/
  // setprompt ANY assistant (e.g. the field-assist scribe a22edcd1-...).
  let inbound;
  if (q.assistant_id) {
    const got = (await vapi('GET', `/assistant/${q.assistant_id}`, key)).json;
    if (!got || !got.id) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'assistant_id not found', assistant_id: q.assistant_id }) };
    inbound = got;
  } else {
    const aResp = await vapi('GET', '/assistant?limit=100', key);
    inbound = listFrom(aResp).find((a) => (a.name || '').trim().toLowerCase() === INBOUND_NAME.toLowerCase());
    if (!inbound) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'Ant Inbound not found', names: listFrom(aResp).map((a) => a.name) }) };
  }

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

  // Dump ANY assistant's live tools + their full parameter schemas, so we can
  // see whether a tool on the live assistant matches the code (e.g. the tech
  // interview save_tech_profile that saved blank). ?action=tooldump&id=<assistantId>
  if (action === 'tooldump') {
    const id = String(q.id || '').trim();
    if (!id) return { statusCode: 400, body: JSON.stringify({ ok: false, error: '?id=<assistantId> required' }) };
    const got = await vapi('GET', `/assistant/${id}`, key);
    if (!got.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, status: got.status, error: got.json }) };
    const m = (got.json && got.json.model) || {};
    const tools = Array.isArray(m.tools) ? m.tools : [];
    const dump = tools.map((t) => {
      const fn = t.function || t;
      const props = (fn.parameters && fn.parameters.properties) || {};
      return { name: fn.name || t.name, url: (t.server && t.server.url) || '', param_count: Object.keys(props).length, params: Object.keys(props), required: (fn.parameters && fn.parameters.required) || [] };
    });
    const a2 = got.json || {};
    const v = a2.voice || {};
    const tr = a2.transcriber || {};
    const cfg = {
      backgroundSound: a2.backgroundSound,
      voice: { provider: v.provider, voiceId: v.voiceId, model: v.model, speed: v.speed },
      transcriber: { provider: tr.provider, model: tr.model, language: tr.language, endpointing: tr.endpointing },
      model: (a2.model || {}).model,
      responseDelaySeconds: a2.responseDelaySeconds,
      llmRequestDelaySeconds: a2.llmRequestDelaySeconds,
      numWordsToInterruptAssistant: a2.numWordsToInterruptAssistant,
      startSpeakingPlan: a2.startSpeakingPlan,
      stopSpeakingPlan: a2.stopSpeakingPlan,
      silenceTimeoutSeconds: a2.silenceTimeoutSeconds,
      tool_fillers: tools.map((t) => ({ name: (t.function && t.function.name) || t.name, request_start: (Array.isArray(t.messages) ? (t.messages.find((m) => m.type === 'request-start') || {}).content : undefined) })),
    };
    return { statusCode: 200, body: JSON.stringify({ ok: true, assistant: a2.name, maxDurationSeconds: a2.maxDurationSeconds, tool_count: tools.length, config: cfg, tools: dump }, null, 2) };
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

  // Ring the office phone for a no-second-phone test. Places an outbound Vapi
  // call to the office DID (default 615-588-9591) so the app rings; answer it to
  // check incoming audio + mic. ...&action=ringtest  (optional &to=+1XXXXXXXXXX)
  if (action === 'ringtest') {
    const to = q.to || '+16155889591';
    const phones = listFrom(await vapi('GET', '/phone-number?limit=100', key));
    const fromP = phones.find((p) => p.id && p.number !== to) || phones.find((p) => p.id);
    if (!fromP) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no usable from-number in Vapi' }) };
    const callResp = await vapi('POST', '/call', key, {
      phoneNumberId: fromP.id,
      assistantId: inbound.id,
      customer: { number: to },
    });
    return { statusCode: 200, body: JSON.stringify({
      ok: callResp.ok, status: callResp.status,
      from: fromP.number, to,
      call_id: (callResp.json && callResp.json.id) || null,
      detail: callResp.json && (callResp.json.message || callResp.json.error) || null,
    }, null, 2) };
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
    // Preferred: a real DID assigned to the office-phone credential connection.
    // Vapi transferring to a NUMBER (warm) is reliable; transferring to a SIP URI
    // is a blind REFER Vapi's carrier can't deliver to a browser (rings then
    // silent). Pass &number=+1XXXXXXXXXX, or store vault secret TELNYX_OFFICE_DID.
    const OFFICE_NUMBER = q.number || (await getSecret('TELNYX_OFFICE_DID')) || '';
    const OFF = String(q.apply || '').toLowerCase() === 'off';
    const tools = Array.isArray(model.tools) ? model.tools.slice() : [];

    // 1) tools: drop any existing transferCall, re-add (unless disabling).
    let newTools = tools.filter((t) => t.type !== 'transferCall');
    // ensure capture_callback fallback is present
    if (!newTools.some((t) => tname(t) === 'capture_callback')) {
      newTools.push(toolBody(TOOLS.find((t) => t.name === 'capture_callback')));
    }
    if (!OFF) {
      // PLAIN transfer to a real number — Vapi's default blind hand-off (no warm
      // transferPlan, which was throwing error-transfer-failed). Vapi REFERs the
      // call to the office number; for the ring-group DID that rings both cells.
      const dest = OFFICE_NUMBER
        ? { type: 'number', number: OFFICE_NUMBER, message: 'One second — let me connect you with our office.' }
        : { type: 'sip', sipUri: OFFICE_SIP_URI, message: 'One second — let me connect you with our office.' };
      newTools.push({ type: 'transferCall', destinations: [dest] });
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
