// trial-ann-admin — stand up + manage a FREE-TRIAL Ann for another shop, entirely via
// API. Mirrors telnyx-ai-admin, but builds a SIMPLE lead-capture Ann from a per-shop
// template (appliance or automotive) instead of TN's full database-wired assistant.
// The trial promise: Ann answers 24/7, captures the lead, texts it to the owner.
//
//   ?action=create&shop=<slug>            -> create the shop's Ann, return assistant_id
//   ?action=update&shop=<slug>&id=<id>    -> re-push the config to an existing Ann
//   ?action=bind&id=<id>&number=+1...     -> route a phone number's inbound to it
//   ?action=get&id=<id>                   -> full config
//   ?action=delete&id=<id>
//   ?action=list
// Guarded by the vapi-admin secret. TELNYX_API_KEY comes from the vault.
'use strict';

const { getSecret } = require('./_lib/secrets');
const shops = require('./_lib/trial-shops');
const TELNYX = 'https://api.telnyx.com/v2';
const SITE = 'https://tnapplianceexchange.net';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const LEAD_TOOL = `${SITE}/.netlify/functions/trial-ann-lead`;
const VOICE_BROOKE = 'Inworld.Max.Brooke';
const MODEL = 'openai/gpt-5.4';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// ── The trial-Ann persona. Warm front-desk voice whose ONE job is to make sure a
// caller never hits voicemail: understand what they need, capture a clean callable
// lead, and hand it to the owner. She does NOT quote prices, promise times, or invent
// services — the owner confirms all of that when he calls right back.
function buildInstructions(shop) {
  const isAuto = shop.type === 'automotive';
  const owner = shop.ownerFirst || 'the owner';
  const area = shop.area ? ` serving ${shop.area}` : '';
  const hours = shop.hours || 'Monday to Friday, 8 to 5';

  const capture = isAuto
    ? `WHAT TO CAPTURE (automotive): their name, the best callback number, the VEHICLE — year, make, and model (always get all three; read the year back to be sure), and a short description of what's going on with it (the noise, the warning light, what it's doing or not doing). Their city or where the car is helps too. Get the vehicle right — that's what ${owner} needs to know before he calls back.`
    : `WHAT TO CAPTURE (appliance): their name, the best callback number, the APPLIANCE (fridge, washer, dryer, oven, dishwasher, etc.) and its brand if they know it, and a short description of what it's doing or not doing. Their city helps too.`;

  // Optional shop-knowledge block — what Ann can ANSWER for callers (services, hours,
// rough pricing the owner is OK sharing). Makes her a real CSR. She stays strictly
// inside it; anything past it becomes a callback.
  const aboutBlock = (shop.about && String(shop.about).trim())
    ? `\n\nWHAT YOU KNOW ABOUT ${shop.name.toUpperCase()} (answer caller questions from THIS, and only this — it's what ${owner} has cleared you to share):\n${String(shop.about).trim()}\nIf a caller asks something that ISN'T covered here, don't guess — warmly say "great question, let me have ${owner} confirm that for you when he calls right back," and make sure that question rides along in the lead.`
    : '';

  const scopeLine = isAuto
    ? (shop.autoScope === 'classic'
      ? `${shop.name} specializes in CLASSIC and restoration work, so match that energy — these are people who love their cars. Be genuinely interested in what they've got.`
      : `${shop.name} handles automotive repair and service. Be warm and capable, like the best service advisor in town.`)
    : `${shop.name} handles home appliance repair. Be warm and capable, like the best front-desk person a repair shop could have.`;

  return `You are Ann, the friendly voice of ${shop.name}${area}. You answer the phone. Be warm, natural, and concise — like the best front-desk person a shop could have. Keep replies short and conversational; this is a phone call.

${scopeLine}${aboutBlock}

SPEAK THEIR LANGUAGE: detect the caller's language from their first words. If they speak Spanish (or another language you're genuinely fluent in), conduct the whole rest of the call in it, naturally, without announcing the switch. If it's a language you can't handle well, warmly stay in English and do your best.

YOUR NUMBER ONE JOB: make sure this caller never hits voicemail and never falls through the cracks. Every other shop sends folks to voicemail — here, a real, warm voice always picks up, day or night. So find out what they need, get their details, and make sure ${owner} gets it. That's the whole game: a caller who feels heard, and a lead that lands on ${owner}'s phone.

WE ANSWER AROUND THE CLOCK: you answer 24/7, 365 — day, night, weekends, holidays. Be honest about the hand-off, though: YOU capture everything anytime, and ${owner} (or the shop) follows up in person during business hours, ${hours}. Never imply someone will transfer them to a live person right now if it's after hours — just reassure them their info is in good hands and ${owner} will call them right back.

SAFETY FIRST, ALWAYS: if a caller describes an active emergency — a fire, smoke, a gas or fuel smell, sparking or a burning smell, someone injured, or (for a vehicle) a crash or someone stranded somewhere unsafe — STOP and tell them warmly but firmly to hang up and call 911 (or roadside assistance / their gas company) right now. Their safety comes first; we'll gladly help once they're safe. Never troubleshoot a hazard over the phone.

HOW YOU RUN THE CALL:
1) Warm open — you've already greeted them. Find out what's going on, one question at a time. Let them tell the story; show you get it ("Oh no, that's no fun — let's get you taken care of").
2) ${capture}
3) Once you've got their name, callback number, and what they need, CAPTURE THE LEAD — say a short natural line first ("Perfect, let me get this over to ${owner} right now"), THEN use the capture_lead tool. Never go silent while a tool runs; keep talking warmly.
4) Confirm and reassure: "I've got all that down and I'm sending it straight to ${owner} — he'll give you a call right back. Anything else I can help you with?"
5) When they're done, wrap up kindly and use the hangup tool.

WHAT YOU DO **NOT** DO (this matters — you're the front desk, not the shop):
- Do NOT invent prices or make up an estimate. You MAY share the specific pricing or specials listed in your shop info above, exactly as written (e.g. a posted starting price or a current special). For anything not listed there, warmly say ${owner} will give exact numbers when he calls right back.
- Do NOT promise a specific appointment day or time. Say ${owner} will confirm scheduling when he calls back.
- Do NOT invent services, hours, or details you don't actually know. If you're unsure, say "great question — let me have ${owner} confirm that for you when he calls right back," and make sure that question is in the lead (you can add it to the summary).
- Never make something up to sound smart. A warm "${owner} will confirm that for you right back" beats a confident wrong answer every time.

IF A CALLER JUST WANTS A PERSON RIGHT NOW: that's okay — reassure them warmly that you'll get their details straight to ${owner} and he'll call them right back, usually quickly. Capture the lead and set that expectation. (You don't transfer during a trial; the callback is the promise.)

IF SOMETHING NEEDS TO REACH ${owner} that isn't a normal lead (a message, a heads-up, a question you couldn't answer): use the message_owner tool to text it to him.

STYLE: brief, warm, human. One question at a time. Confirm what you did ("I just sent that over to ${owner}"). Make every caller feel like the most important call of the day.`;
}

function defaultGreeting(shop) {
  if (shop.greeting) return shop.greeting;
  return `Thanks for calling ${shop.name} — this is Ann. We're here for you around the clock. How can I help you today?`;
}

function webhookTool(name, description, url, properties, required) {
  return { type: 'webhook', webhook: { name, description, url, method: 'POST', body_parameters: { type: 'object', properties, required: required || [] } } };
}

function buildTools(shop, toolKey) {
  const isAuto = shop.type === 'automotive';
  const q = (base) => base + `?shop=${encodeURIComponent(shop.slug)}` + (toolKey ? `&k=${encodeURIComponent(toolKey)}` : '');

  const leadProps = isAuto
    ? {
      name: { type: 'string', description: "the caller's name" },
      phone: { type: 'string', description: 'best callback number, digits' },
      vehicle: { type: 'string', description: 'year, make, and model — e.g. "1969 Chevy Camaro"' },
      issue: { type: 'string', description: "what's going on with the vehicle — the symptom, noise, or service they want" },
      city: { type: 'string', description: 'their city or where the vehicle is (optional)' },
    }
    : {
      name: { type: 'string', description: "the caller's name" },
      phone: { type: 'string', description: 'best callback number, digits' },
      appliance: { type: 'string', description: 'the appliance + brand if known — e.g. "Whirlpool refrigerator"' },
      problem: { type: 'string', description: "what it's doing or not doing" },
      city: { type: 'string', description: 'their city (optional)' },
    };

  return [
    webhookTool('capture_lead',
      isAuto
        ? "Send the caller's lead straight to the shop owner's phone. Use once you have their name, callback number, the vehicle (year/make/model), and what they need. This is how the lead reaches the shop — always do it before ending a call with a real caller."
        : "Send the caller's lead straight to the shop owner's phone. Use once you have their name, callback number, the appliance, and what it's doing. This is how the lead reaches the shop — always do it before ending a call with a real caller.",
      q(`${LEAD_TOOL}?do=capture_lead`), leadProps, ['phone']),
    webhookTool('message_owner',
      "Text a free-form note to the shop owner — a message, a heads-up, or a question you couldn't answer for the caller. Use when something should reach the owner that isn't a standard new lead.",
      q(`${LEAD_TOOL}?do=message_owner`), { message: { type: 'string', description: 'what to pass along to the owner' } }, ['message']),
    { type: 'hangup', hangup: { description: 'End the call politely once the conversation is complete and there is nothing left to help with.' } },
  ];
}

function assistantBody(shop, toolKey) {
  return {
    name: `Ann — ${shop.name} (trial)`,
    model: MODEL,
    instructions: buildInstructions(shop),
    greeting: defaultGreeting(shop),
    description: `${shop.name} phone AI (free trial) — answers 24/7, captures the lead, texts it to the owner.`,
    voice_settings: { voice: VOICE_BROOKE, voice_speed: 1.0 },
    transcription: { model: 'deepgram/flux', language: 'auto' },
    tools: buildTools(shop, toolKey),
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
    if (action === 'list') return json(200, await call('GET', '/ai/assistants?page[size]=20'));
    if (action === 'get') return json(200, await call('GET', `/ai/assistants/${q.id}`));
    if (action === 'delete') return json(200, await call('DELETE', `/ai/assistants/${q.id}`));

    if (action === 'create' || action === 'update') {
      const shop = shops.get(q.shop);
      if (!shop) return json(200, { ok: false, error: 'unknown shop: ' + (q.shop || '') + ' — add it to _lib/trial-shops.js first' });
      if (!shop.name || !shop.ownerCell) return json(200, { ok: false, error: 'shop needs at least name + ownerCell in trial-shops.js' });
      shop.slug = String(q.shop).toLowerCase().trim();
      const toolKey = q.tool_key || (await getSecret('TELNYX_TOOL_SECRET')) || '';
      if (action === 'update') {
        if (!q.id) return json(200, { ok: false, error: 'need ?id=' });
        const res = await call('PATCH', `/ai/assistants/${q.id}`, assistantBody(shop, toolKey));
        return json(200, { ok: res.ok, status: res.status, shop: shop.name, response: res.data });
      }
      const res = await call('POST', '/ai/assistants', assistantBody(shop, toolKey));
      const id = res.data && (res.data.id || (res.data.data && res.data.data.id));
      return json(200, { ok: res.ok, status: res.status, shop: shop.name, type: shop.type, assistant_id: id || null, response: res.data });
    }

    if (action === 'bind') {
      const id = q.id; const number = q.number;
      if (!id || !number) return json(200, { ok: false, error: 'need ?id= and ?number=+1...' });
      const attempts = [];
      let r = await call('POST', `/ai/assistants/${id}/phone_numbers`, { phone_number: number });
      attempts.push({ path: 'phone_numbers', status: r.status, data: r.data });
      if (!r.ok) { r = await call('POST', `/ai/assistants/${id}/phone_numbers/assign`, { phone_number: number }); attempts.push({ path: 'assign', status: r.status, data: r.data }); }
      return json(200, { ok: r.ok, bound: r.ok ? number : null, attempts });
    }

    return json(200, { ok: false, error: 'unknown action', actions: ['create', 'update', 'bind', 'get', 'delete', 'list'] });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
