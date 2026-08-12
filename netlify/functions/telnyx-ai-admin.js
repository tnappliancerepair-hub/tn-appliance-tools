// telnyx-ai-admin — stand up + manage the Telnyx Voice AI assistant ("Ann") entirely
// via API (Teddy 2026-08-12: build the better phone AI on Telnyx — greet by name, close
// the loop, gather availability live on the call). Mirrors vapi-admin. Uses the vault
// TELNYX_API_KEY server-side; no portal needed.
//
//   ?action=create              -> create/replace the shadow assistant, return id
//   ?action=list                -> list assistants
//   ?action=get&id=<id>         -> full assistant config
//   ?action=bind&id=<id>&number=+1... -> route a phone number's inbound calls to it
//   ?action=delete&id=<id>
//   ?action=raw&method=GET&path=/ai/...   -> escape hatch for debugging the API
// Guarded by the vapi-admin secret.
'use strict';

const { getSecret } = require('./_lib/secrets');
const TELNYX = 'https://api.telnyx.com/v2';
const SITE = 'https://tnapplianceexchange.net';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const SHADOW_NUMBER = '+16158211400';          // the spare line for the shadow pilot
const VOICE_BROOKE = 'Telnyx.Ultra.e07c00bc-4134-4eae-9ea4-1a55fb45746b'; // "Brooke - Big Sister"
const MODEL_CLAUDE = 'anthropic/claude-haiku-4-5';
const TOOL = `${SITE}/.netlify/functions/telnyx-ai-tool`;
const PRECALL = `${SITE}/.netlify/functions/telnyx-precall-context`;

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

const INSTRUCTIONS = `You are Ann, the friendly voice of TN Appliance Exchange, a family-owned appliance repair company serving Middle Tennessee and Louisiana. You answer the phone. Be warm, natural, and concise, like the best front-desk person a shop could have. Keep replies short and conversational, this is a phone call.

WHO YOU ARE TALKING TO (you already know before you speak):
{{system_context}}
The caller's job number is {{job_id}} (blank if we do not recognize them). Use that value whenever a tool needs job_id.

You already opened with a personalized greeting. Continue naturally from there.

YOUR #1 JOB IS TO CLOSE THE LOOP ON THE CALL. Never end with a vague "someone will call you back." Do the next step right now, on the phone:
- GATHER AVAILABILITY THE SMART WAY, LIVE ON THE CALL. We route the most efficient way and do NOT promise a specific arrival time, but we DO need their real constraints so we never show up at the wrong time. Ask it warmly and get the WHOLE picture: "What days work best for you - and are you generally better in the mornings or the afternoons? And are there any days or times that just won't work?" Capture BOTH the days AND the time-of-day (mornings, afternoons, "after 3", "not before noon", and so on) with capture_availability. Do not make them do this by text.
- If we need a short video of the problem or a photo of the model-number sticker to move forward, tell them you are texting a link and use send_intake_link.
- If the context says the service waiver is NOT signed, offer to text it and use send_waiver_link. It takes about 20 seconds.
- If they need to pay, use send_pay_link to text a secure link.
- If you truly cannot resolve it now, use capture_callback so a human follows up. Never let a caller hang up unhandled.

YOU KNOW THE WHOLE STORY, so use it. The context above tells you what is still open on this job and how many times we have already reached out. If we have been trying to reach them and still need something (like their availability), warmly acknowledge it - be relieved and glad they caught us, NEVER accusatory - and offer to just handle it right now on the call instead of more texts. Example: "I'm so glad you called, we've been trying to reach you to get your days locked in - let's just take care of it right now." Then gather what is missing and close it.

HOW WE SCHEDULE (always say this correctly, and never overpromise):
- We schedule by DAY and route the most efficient way, so NEVER promise a specific arrival time ("2pm", "this afternoon", "in 40 minutes"). You genuinely do not have one.
- But do NOT just tell them "I can't give you a time" and leave it there. Frame it positively: gather when they ARE and are NOT available - days AND mornings vs afternoons - then reassure them: "We'll route it the most efficient way around what works for you, and we text you a live arrival window the morning of." That respects their time without overpromising.
- If a warranty company already gave them a window, that window stands.

TRUTH AND ACCURACY (this matters more than sounding smart):
- Only say what you actually know from the context or a tool result. Never invent a technician, a day, a status, or a part.
- If a lookup is empty or you are unsure, say so warmly and take a callback or text them. "Let me confirm that and text you right back" beats a confident wrong answer.
- Never say "you're not in our system" or "your job is canceled" unless you are certain.
- Never read out part numbers or internal notes to a customer.

WARRANTY REPS vs HOMEOWNERS:
- Warranty companies (American Home Shield, ServicePower, and others) sometimes call to check a claim and they transfer homeowners to us. If it is a warranty rep, give the whole status in one breath: has the tech been out, what we found, the part and ETA, and the return or scheduled day.
- If a rep asks you to close out a claim for a recall, do not. We finish on the original claim, ask them to have the customer text us at 615-588-9500.

HANDING OFF TO A HUMAN:
- Our office is staffed Monday to Friday, 9am to 6pm Central. During those hours, if the caller wants a person, offer to connect them; if no one is available, capture a callback.
- Outside those hours, handle it yourself and take a message with capture_callback. Do not imply a live person will pick up.

NEVER LOSE A CALL: before the call ends, and any time something is urgent (medical, expedited, upset, no-show) or warranty related, use log_outcome to record what happened and flag it to the office. Every call leaves a trail.

STYLE: brief, warm, human. One question at a time. Confirm what you did ("I just texted you that link," "I've got you down for Tuesday"). When they are done, wrap up kindly and use the hangup tool.`;

function webhookTool(name, description, url, properties, required) {
  return { type: 'webhook', webhook: { name, description, url, method: 'POST', body_parameters: { type: 'object', properties, required: required || [] } } };
}

const TOOLS = [
  webhookTool('capture_availability', 'Record the customer availability for their repair, gathered on the call: which days work, the time of day (mornings/afternoons or specific limits), and anything that does NOT work. Use the job number from context.', `${TOOL}?do=capture_availability`,
    { job_id: { type: 'integer', description: "the caller's job number" }, available: { type: 'string', description: 'days that work, e.g. Tuesday or Thursday' }, time_notes: { type: 'string', description: 'time-of-day preference or limits, e.g. "mornings only", "after 3pm", "not before noon"' }, unavailable: { type: 'string', description: 'days or times that do NOT work (optional)' } }, ['available']),
  webhookTool('send_intake_link', 'Text the customer their pre-diagnosis link so they can send a short video of the problem and a photo of the model sticker. Use when we need media to schedule.', `${TOOL}?do=send_intake_link`,
    { job_id: { type: 'integer', description: "the caller's job number" } }, ['job_id']),
  webhookTool('send_waiver_link', 'Text the customer the service waiver to sign. Use when the context says the waiver is NOT signed yet.', `${TOOL}?do=send_waiver_link`,
    { job_id: { type: 'integer', description: "the caller's job number" } }, ['job_id']),
  webhookTool('send_pay_link', 'Text the customer a secure link to pay their balance from their phone.', `${TOOL}?do=send_pay_link`,
    { job_id: { type: 'integer', description: "the caller's job number" } }, ['job_id']),
  webhookTool('capture_callback', 'Log a callback so a human follows up. Use when you cannot resolve something now, or for anything needing office attention.', `${TOOL}?do=capture_callback`,
    { name: { type: 'string' }, phone: { type: 'string' }, summary: { type: 'string', description: 'what they need' }, caller_type: { type: 'string', description: 'customer or warranty_rep' } }, ['summary']),
  webhookTool('log_outcome', 'Record what happened on this call so nothing is ever lost. Set urgent=true for medical/expedited/upset/no-show, warranty=true for warranty matters.', `${TOOL}?do=log_outcome`,
    { job_id: { type: 'integer' }, summary: { type: 'string' }, urgent: { type: 'boolean' }, warranty: { type: 'boolean' }, needs_office: { type: 'boolean' } }, ['summary']),
  { type: 'hangup', hangup: { description: 'End the call politely once the conversation is complete and there is nothing left to help with.' } },
];

function assistantBody() {
  return {
    name: 'Ann (Telnyx shadow)',
    model: MODEL_CLAUDE,
    instructions: INSTRUCTIONS,
    greeting: '{{greeting}}',
    description: 'TN Appliance Exchange phone AI — greets by name, knows the job, closes the loop.',
    voice_settings: { voice: VOICE_BROOKE, voice_speed: 0.9 },   // a tick slower = calmer, clearer
    tools: TOOLS,
    dynamic_variables_webhook_url: PRECALL,
  };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return { statusCode: 403, body: 'forbidden' };
  const KEY = await getSecret('TELNYX_API_KEY');
  if (!KEY) return json(200, { ok: false, error: 'TELNYX_API_KEY not in vault' });
  const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  const action = q.action || 'list';

  const call = async (method, path, body) => {
    const r = await fetch(`${TELNYX}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const d = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, data: d };
  };

  try {
    if (action === 'raw') {
      let body = null; try { body = q.body ? JSON.parse(q.body) : (event.body ? JSON.parse(event.body) : null); } catch (_) {}
      return json(200, await call(q.method || 'GET', q.path || '/ai/assistants', body));
    }
    if (action === 'list') return json(200, await call('GET', '/ai/assistants?page[size]=20'));
    if (action === 'get') return json(200, await call('GET', `/ai/assistants/${q.id}`));
    if (action === 'delete') return json(200, await call('DELETE', `/ai/assistants/${q.id}`));

    if (action === 'create') {
      const res = await call('POST', '/ai/assistants', assistantBody());
      const id = res.data && (res.data.id || (res.data.data && res.data.data.id));
      return json(200, { ok: res.ok, status: res.status, assistant_id: id || null, response: res.data });
    }

    if (action === 'update') {
      if (!q.id) return json(200, { ok: false, error: 'need ?id=' });
      const res = await call('PATCH', `/ai/assistants/${q.id}`, assistantBody());
      return json(200, { ok: res.ok, status: res.status, response: res.data });
    }

    if (action === 'bind') {
      const id = q.id; const number = q.number || SHADOW_NUMBER;
      if (!id) return json(200, { ok: false, error: 'need ?id=' });
      // Try the documented assistant phone-number assignment, then fall back to the
      // number's voice settings pointing at the assistant.
      const attempts = [];
      let r = await call('POST', `/ai/assistants/${id}/phone_numbers`, { phone_number: number });
      attempts.push({ path: `/ai/assistants/${id}/phone_numbers`, status: r.status, data: r.data });
      if (!r.ok) { r = await call('POST', `/ai/assistants/${id}/phone_numbers/assign`, { phone_number: number }); attempts.push({ path: 'assign', status: r.status, data: r.data }); }
      return json(200, { ok: r.ok, bound: r.ok ? number : null, attempts });
    }

    return json(200, { ok: false, error: 'unknown action', actions: ['create', 'list', 'get', 'bind', 'update', 'delete', 'raw'] });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
