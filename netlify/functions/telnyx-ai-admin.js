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
// Same "Brooke" persona Teddy likes, but on Inworld's top "Max" tier — smoother + more
// natural than the Telnyx house voice. (Telnyx has no ElevenLabs/Cartesia.)
const VOICE_BROOKE = 'Inworld.Max.Brooke';
// A/B: gpt-5.4 (Teddy wants to hear the higher tier vs 5.1). Revert to openai/gpt-5.1 if
// there's any voice lag — that's the locked-in default. Telnyx-hosted, no key.
const MODEL_CLAUDE = 'openai/gpt-5.4';
const TOOL = `${SITE}/.netlify/functions/telnyx-ai-tool`;
const PRECALL = `${SITE}/.netlify/functions/telnyx-precall-context`;
const OFFICE_RING = '+16155889591';                    // dialing this cascades Sofia→Danielle→Teddy (office-texml)
const TRANSFER_FROM = '+16158211400';                  // owned, voice-enabled line the transfer leg dials from
// Field techs — transfer targets for the day-of "connect me to my tech" call.
const TECH_TARGETS = [
  { name: 'Teddy', to: '+16154855795' },   // owner-tech (id 1) + the test target
  { name: 'Jimmy', to: '+16159671304' },
  { name: 'Andre', to: '+15049099413' },
  { name: 'Lee', to: '+16158291654' },
  { name: 'John', to: '+18133527686' },
];

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

const INSTRUCTIONS = `You are Ann, the friendly voice of TN Appliance Exchange, a family-owned appliance repair company serving Middle Tennessee and Louisiana. You answer the phone. Be warm, natural, and concise, like the best front-desk person a shop could have. Keep replies short and conversational, this is a phone call.

WHO YOU ARE TALKING TO (you already know before you speak):
{{system_context}}
The caller's job number is {{job_id}} (blank if we do not recognize them). Use that value whenever a tool needs job_id.

You already opened with a personalized greeting. Continue naturally from there.

MATCH YOUR POSTURE TO THE CALL (the context tells you which track this is):
- CASH (self-pay) or a caller you don't yet know: this is a job to WIN. Be your sharpest, most consultative self - warm, confident, clearly on their side - and move them toward getting booked. Be transparent about options and pricing, make it easy to say yes (the $50 quick diagnostic, or a quick video + model-number photo so we pre-diagnose and often bring the part first trip), and NEVER let them hang up without a concrete next step: booked, a scheduling hold, or an intake link sent.
- WARRANTY: the job is already ours. Serve it fast, warm, and accurate - confirm the claim, give clear status, gather anything missing, connect them to their tech. Don't sell; just handle it beautifully and get them off the phone happy.

IF YOU DO NOT RECOGNIZE THE CALLER (the context says they are not identified): warmly get their phone number OR name OR claim number and immediately use the lookup_customer tool to pull them up - do this BEFORE asking them to explain everything, so they never have to repeat themselves. Only if lookup finds nothing do you ask them to tell you about the appliance from scratch. Never sit silent - always either ask one clear question or take an action.

YOUR #1 JOB IS TO CLOSE THE LOOP ON THE CALL. Never end with a vague "someone will call you back." Do the next step right now, on the phone:
- GATHER AVAILABILITY THE SMART WAY, LIVE ON THE CALL. We route the most efficient way and do NOT promise a specific arrival time, but we DO need their real openness so we never show up at the wrong time. Ask it warmly, in a way that invites the full picture PER DAY: "What days work for you - and on those days, are you pretty wide open, or do you need mornings or afternoons?" Customers will often answer per day (for example: "Wednesday I'm wide open, Thursday only afternoons, Friday mornings") - capture EXACTLY that in capture_availability, keeping each day's time-of-day, plus anything that won't work. Do not make them do this by text.
- If we need a short video of the problem or a photo of the model-number sticker to move forward, tell them you are texting a link and use send_intake_link.
- If the context says the service waiver is NOT signed, offer to text it and use send_waiver_link. It takes about 20 seconds.
- If they need to pay, use send_pay_link to text a secure link.
- If you truly cannot resolve it now, use capture_callback so a human follows up. Never let a caller hang up unhandled.

YOU KNOW THE WHOLE STORY, so use it. The context above tells you what is still open on this job and how many times we have already reached out. If we have been trying to reach them and still need something (like their availability), warmly acknowledge it - be relieved and glad they caught us, NEVER accusatory - and offer to just handle it right now on the call instead of more texts. Example: "I'm so glad you called, we've been trying to reach you to get your days locked in - let's just take care of it right now." Then gather what is missing and close it.

HOW WE SCHEDULE (always say this correctly, and never overpromise):
- We schedule by DAY and route the most efficient way, so NEVER promise a specific arrival time ("2pm", "this afternoon", "in 40 minutes"). You genuinely do not have one.
- But do NOT just tell them "I can't give you a time" and leave it there. Frame it positively: gather when they ARE and are NOT available - days AND mornings vs afternoons - then reassure them: "We'll route it the most efficient way around what works for you, and we text you a live arrival window the morning of." That respects their time without overpromising.
- If a warranty company already gave them a window, that window stands.

WHEN A CALLER WANTS ON THE SCHEDULE NOW ("I really need to get on the schedule"):
- Don't make them wait for a callback. Ask which day works ("What day would you like - I'll go ahead and get you on"), and use place_hold with that day (and a time preference if they give one). This files a CUSTOMER SCHEDULING REQUEST right on the call - they've done their part.
- Then reassure them exactly this way: "I've got your scheduling request in for [day]. Our office will confirm it, and if our route can't make that exact day, they'll call you right back to find one that works." Never promise it's final - the office approves it.
- This is still day-based: if they offer a clock time, capture it as their preference (place_hold time) but do not promise we arrive at that time.

TRUTH AND ACCURACY (this matters more than sounding smart):
- Only say what you actually know from the context or a tool result. Never invent a technician, a day, a status, or a part.
- If a lookup is empty or you are unsure, say so warmly and take a callback or text them. "Let me confirm that and text you right back" beats a confident wrong answer.
- Never say "you're not in our system" or "your job is canceled" unless you are certain.
- Never read out part numbers or internal notes to a customer.

WARRANTY REPS - GET THE WORK ORDER, CONFIRM THE CUSTOMER, THEN HAND OFF WARM (most reps just want a person):
Warranty companies (American Home Shield, ServicePower, and others) call to check or schedule a claim, and they usually want to talk to a scheduler. When it's a rep, don't try to fully handle it yourself - your job is to brief the office and hand off cleanly:
1) Warmly ask for the WORK ORDER / dispatch / claim number: "Of course - what's the work order number on that claim?"
2) Look it up (use lookup_customer with the claim number) and CONFIRM THE CUSTOMER out loud so you both know it's the right job: "Got it - that's <customer name> in <city> for the <appliance>, is that right?"
3) Then hand off warm: call alert_office with the claim number (and a short note like "AHS rep, WO 12345, checking status" or "wants to schedule"). This pops the customer's WHOLE story onto the office's screen AND texts the scheduler, so whoever picks up already knows the customer, the claim, and what's going on before they even say hello.
4) Read office_open: if TRUE, say "Perfect - I've got <customer> pulled up for our scheduler, connecting you now and they'll already have everything," then use the transfer tool (Office). If FALSE (after hours), take the details with capture_callback and let them know our office follows up Monday to Friday, 9 to 6.
If a rep truly only wants a quick status and not a person, you can give it in one breath (has the tech been out, what we found, the part and ETA, the return or scheduled day) - but still grab the work order number first so it's on record. If a rep asks you to close out a claim for a recall, do NOT - we finish on the original claim; ask them to have the customer text us at 615-588-9500.

DAY-OF "WHERE'S MY TECH?" - CONNECT THEM STRAIGHT TO THE TECH (a huge time-saver):
When the caller is ON TODAY'S ROUTE (the context will say "ON TODAY'S ROUTE with <name>") and they're asking where their tech is, when he'll arrive, or just checking on today's appointment - do NOT route them through the office. Offer to connect them straight to their tech:
1) Say it warmly, like the context tells you: "It looks like you're on <tech>'s schedule today - would you like me to connect you with him? Give me just a minute."
2) On yes, call connect_to_tech (pass the job_id) - this texts <tech> a heads-up that they're on the line so he knows who's calling.
3) Then use the transfer tool to the target whose name matches <tech> (Jimmy, Andre, Lee, or John). It rings his phone for about five rings.
4) IF HE DOESN'T PICK UP (the connection doesn't go through - he's likely hands-deep in a repair): do NOT leave the caller hanging. Come back warmly: "Looks like <tech>'s hands are full on a job right now - let me take your message and I'll text it straight to his phone so he gets right back to you. What would you like me to tell him?" Get their message, then use message_for_tech (tech_name = <tech>, ALWAYS pass job_id from context, and the message in their own words). Their callback number is already on file and gets attached automatically - you do NOT need to ask them to recite it (only capture a number if they want you to use a DIFFERENT one). Confirm: "Got it - I just texted that straight to <tech> with your number, he'll get right back to you."
5) Never quote a clock time yourself - we run day-of routing; the tech gives them the live window. If they'd rather not be connected at all, reassure them their tech has them on today's route and will text a live arrival window, and offer to pass a message with message_for_tech.
Only do this when the context flags them ON TODAY'S ROUTE with a named tech. If they're NOT on today's route (scheduled another day, waiting on parts, etc.), handle it yourself or use the office warm transfer below.

WARM TRANSFER TO A HUMAN (do this smoothly - it is the heart of great service):
Our office is staffed Monday to Friday, 9am to 6pm Central. When a caller genuinely wants a person - or is upset, or a warranty rep needs a scheduler - do a WARM transfer, never a cold dump:
1) FIRST call alert_office (pass the job_id from context, or the work-order/claim number if a warranty rep gave one, plus a short note on why - e.g. "wants to reschedule", "upset about a no-show", "AHS checking claim status"). This pops the caller's WHOLE story onto the office's screens, so whoever answers already sees who is on the line and why - they never have to ask the customer to repeat anything. It also tells you office_open (whether a live person is available right now).
2) READ office_open in the result:
   - If office_open is TRUE: tell the caller warmly, "I'm connecting you now - and don't worry, they can already see everything about your call, so you won't have to start over. One moment." THEN use the transfer tool (Office) to connect them. The office rings the right people in order automatically.
   - If office_open is FALSE (evening or weekend): do NOT use the transfer tool and do NOT imply anyone will pick up. Say warmly, "Our office is closed right now, but I've made sure they have everything - let me take down what you need so they call you first thing." Then capture_callback and set the expectation: "our team follows up Monday through Friday, 9 to 6."
3) For an upset caller demanding a person ("representative! representative!"), do NOT argue or stall - acknowledge them, run this exact flow, and reassure them help is coming: "Absolutely - I'm getting you to a person right now."
Never promise WHICH person will pick up (the office routes it). Never transfer outside office hours.

NEVER LOSE A CALL: before the call ends, and any time something is urgent (medical, expedited, upset, no-show) or warranty related, use log_outcome to record what happened and flag it to the office. Every call leaves a trail.

STYLE: brief, warm, human. One question at a time. Confirm what you did ("I just texted you that link," "I've got you down for Tuesday"). When they are done, wrap up kindly and use the hangup tool.`;

function webhookTool(name, description, url, properties, required) {
  return { type: 'webhook', webhook: { name, description, url, method: 'POST', body_parameters: { type: 'object', properties, required: required || [] } } };
}

const TOOLS = [
  webhookTool('capture_availability', 'Record the customer availability for their repair, gathered on the call: which days work, the time of day (mornings/afternoons or specific limits), and anything that does NOT work. Use the job number from context.', `${TOOL}?do=capture_availability`,
    { job_id: { type: 'integer', description: "the caller's job number" }, available: { type: 'string', description: 'days that work, e.g. Tuesday or Thursday' }, time_notes: { type: 'string', description: 'time-of-day preference or limits, e.g. "mornings only", "after 3pm", "not before noon"' }, unavailable: { type: 'string', description: 'days or times that do NOT work (optional)' } }, ['available']),
  webhookTool('lookup_customer', "Look up who's calling when you don't already know them. Use the moment an unidentified caller gives you their phone number, name, or a work-order/claim number. Returns their name and the status of their repair so you can help right away. ALWAYS try this before asking a caller to repeat themselves or taking a message.", `${TOOL}?do=lookup`,
    { phone: { type: 'string', description: "the caller's phone number, digits only if possible" }, name: { type: 'string', description: 'their name if that is what they gave' }, claim: { type: 'string', description: 'a work-order or claim number' } }, []),
  webhookTool('send_intake_link', 'Text the customer their pre-diagnosis link so they can send a video of the problem (any length is fine) and a photo of the model-number sticker. Use when we need media to schedule.', `${TOOL}?do=send_intake_link`,
    { job_id: { type: 'integer', description: "the caller's job number" } }, ['job_id']),
  webhookTool('place_hold', "File a CUSTOMER SCHEDULING REQUEST for the day they want, right now on the call. Use when a caller says they need to get on the schedule and tells you a day (and optionally a time). This puts them on tentatively for the office to approve or call back to adjust - the customer has done their part. Pass the day as they said it ('Friday', 'tomorrow', 'next Wednesday', '8/15') and any time preference ('afternoon', '3pm', 'mornings').", `${TOOL}?do=place_hold`,
    { job_id: { type: 'integer', description: "the caller's job number, from context" }, day: { type: 'string', description: "the day the customer wants, in their words: 'Friday', 'tomorrow', 'next Wednesday', '8/15'" }, time: { type: 'string', description: "time preference if they gave one: 'afternoon', 'mornings', '3pm' (optional)" } }, ['day']),
  webhookTool('send_waiver_link', 'Text the customer the service waiver to sign. Use when the context says the waiver is NOT signed yet.', `${TOOL}?do=send_waiver_link`,
    { job_id: { type: 'integer', description: "the caller's job number" } }, ['job_id']),
  webhookTool('send_pay_link', 'Text the customer a secure link to pay their balance from their phone.', `${TOOL}?do=send_pay_link`,
    { job_id: { type: 'integer', description: "the caller's job number" } }, ['job_id']),
  webhookTool('capture_callback', 'Log a callback so a human follows up. Use when you cannot resolve something now, or for anything needing office attention.', `${TOOL}?do=capture_callback`,
    { name: { type: 'string' }, phone: { type: 'string' }, summary: { type: 'string', description: 'what they need' }, caller_type: { type: 'string', description: 'customer or warranty_rep' } }, ['summary']),
  webhookTool('alert_office', "Pull this caller up on the office's phones with a one-tap link to their tile, and let the office know they're on the line. Use the moment a human is genuinely needed: the caller asks for a person, or a warranty rep gives you a work-order/claim number to look up. Pass the caller's job number, or the work-order/claim number if a warranty rep gave one.", `${TOOL}?do=alert_office`,
    { job_id: { type: 'integer', description: "the caller's job number, from context" }, claim: { type: 'string', description: 'work-order or claim number if a warranty rep gave one' }, note: { type: 'string', description: 'one short line on why — e.g. "wants to reschedule", "upset about no-show", "AHS checking claim status"' } }, []),
  webhookTool('log_outcome', 'Record what happened on this call so nothing is ever lost. Set urgent=true for medical/expedited/upset/no-show, warranty=true for warranty matters.', `${TOOL}?do=log_outcome`,
    { job_id: { type: 'integer' }, summary: { type: 'string' }, urgent: { type: 'boolean' }, warranty: { type: 'boolean' }, needs_office: { type: 'boolean' } }, ['summary']),
  webhookTool('connect_to_tech', "Connect the caller STRAIGHT to their technician. Use ONLY when the context says they are ON TODAY'S ROUTE and they're calling to check on arrival / where their tech is / when he'll get there. It texts the tech a heads-up that they're on the line. After it returns, use the transfer tool to the target whose name matches the tech (Jimmy, Andre, Lee, or John).", `${TOOL}?do=connect_to_tech`,
    { job_id: { type: 'integer', description: "the caller's job number, from context" } }, ['job_id']),
  webhookTool('message_for_tech', "Text the caller's message straight to their technician's phone, and flag the office he missed a live call. Use when the tech does NOT pick up after you tried to connect them, or when the caller would rather just leave him a message. The customer's callback number is pulled from the job automatically, so you don't need to ask them for it (only pass customer_phone if they gave a DIFFERENT number). ALWAYS pass job_id from context.", `${TOOL}?do=message_for_tech`,
    { tech_name: { type: 'string', description: 'the tech first name from context (Jimmy, Andre, Lee, John)' }, message: { type: 'string', description: "the customer's message, in their own words" }, job_id: { type: 'integer', description: "the caller's job number from context — always pass this so the callback number attaches" }, customer_name: { type: 'string' }, customer_phone: { type: 'string', description: 'ONLY if they want a different callback number than the one on file' }, appliance: { type: 'string' } }, ['tech_name', 'message', 'job_id']),
  // WARM TRANSFER — connect the caller to a live person (the office) OR straight to their
  // field tech. Ann briefs first (alert_office pops the office's screens; connect_to_tech
  // texts the tech), THEN uses this to bridge to the matching target. The office target
  // rings the Sofia→Danielle→Teddy cascade; tech targets ring that tech's cell.
  { type: 'transfer', transfer: { from: TRANSFER_FROM, timeout_secs: 30, targets: [{ name: 'Office', to: OFFICE_RING }, ...TECH_TARGETS] } },
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
    // SAFETY NET: default values so {{greeting}} / {{system_context}} / {{job_id}} always
    // render cleanly even if the pre-call webhook is slow or fails — the call never opens
    // with a blank or a literal "{{greeting}}".
    dynamic_variables: {
      greeting: 'Thanks for calling TN Appliance Exchange! Who do I have the pleasure of speaking with?',
      system_context: 'The caller is not yet identified. Warmly ask their name and how you can help, then use the lookup_customer tool with their phone number, name, or claim number to pull up their repair.',
      job_id: '',
      caller_first: '',
    },
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
