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
  const isDealer = shop.type === 'dealership';
  const owner = shop.ownerFirst || 'the owner';
  const area = shop.area ? ` serving ${shop.area}` : '';
  const hours = shop.hours || 'Monday to Friday, 8 to 5';

  const capture = isDealer
    ? `WHAT TO CAPTURE (vehicle sales): their name, the best callback number, and WHAT THEY'RE LOOKING FOR — the kind of vehicle (for a work van: cargo vs passenger, the size, any make/model they have in mind, and what they'll use it for), their rough budget or monthly payment target, whether they'll need financing, and whether they have a trade-in. Also ask if they'd like to come by for a look or a test drive. That's what ${owner} needs to line up the right vehicle before he calls them back.`
    : isAuto
    ? `WHAT TO CAPTURE (automotive): their name, the best callback number, the VEHICLE — year, make, and model (always get all three; read the year back to be sure), and a short description of what's going on with it (the noise, the warning light, what it's doing or not doing). Their city or where the car is helps too. Get the vehicle right — that's what ${owner} needs to know before he calls back.`
    : `WHAT TO CAPTURE (appliance): their name, the best callback number, the APPLIANCE (fridge, washer, dryer, oven, dishwasher, etc.) and its brand if they know it, and a short description of what it's doing or not doing. Their city helps too.`;

  // Optional shop-knowledge block — what Ann can ANSWER for callers (services, hours,
// rough pricing the owner is OK sharing). Makes her a real CSR. She stays strictly
// inside it; anything past it becomes a callback.
  const aboutBlock = (shop.about && String(shop.about).trim())
    ? `\n\nWHAT YOU KNOW ABOUT ${shop.name.toUpperCase()} (answer caller questions from THIS, and only this — it's what ${owner} has cleared you to share):\n${String(shop.about).trim()}\nIf a caller asks something that ISN'T covered here, don't guess — warmly say "great question, let me have ${owner} confirm that for you when he calls right back," and make sure that question rides along in the lead.`
    : '';

  const scopeLine = isDealer
    ? `${shop.name} is a used car lot — you're the friendly, no-pressure salesperson who helps buyers find the right vehicle. Be genuinely helpful and easygoing; the goal is to get them excited to come see it and to hand ${owner} a warm lead.`
    : isAuto
    ? (shop.autoScope === 'classic'
      ? `${shop.name} specializes in CLASSIC and restoration work, so match that energy — these are people who love their cars. Be genuinely interested in what they've got.`
      : `${shop.name} handles automotive repair and service. Be warm and capable, like the best service advisor in town.`)
    : `${shop.name} handles home appliance repair. Be warm and capable, like the best front-desk person a repair shop could have.`;

  return `You are ${shop.botName || 'Ant'}, the friendly voice of ${shop.name}${area}. You answer the phone. Be warm, natural, and concise — like the best front-desk person a shop could have. Keep replies short and conversational; this is a phone call.

${scopeLine}${aboutBlock}

SPEAK THEIR LANGUAGE: detect the caller's language from their first words. If they speak Spanish (or another language you're genuinely fluent in), conduct the whole rest of the call in it, naturally, without announcing the switch. If it's a language you can't handle well, warmly stay in English and do your best.

YOUR NUMBER ONE JOB: make sure this caller never hits voicemail and never falls through the cracks. Every other shop sends folks to voicemail — here, a real, warm voice always picks up, day or night. So find out what they need, get their details, and make sure ${owner} gets it. That's the whole game: a caller who feels heard, and a lead that lands on ${owner}'s phone.

WE ANSWER AROUND THE CLOCK: you answer 24/7, 365 — day, night, weekends, holidays. Be honest about the hand-off, though: YOU capture everything anytime, and ${owner} (or the shop) follows up in person during business hours, ${hours}. Never imply someone will transfer them to a live person right now if it's after hours — just reassure them their info is in good hands and ${owner} will call them right back.

SAFETY FIRST, ALWAYS: if a caller describes an active emergency — a fire, smoke, a gas or fuel smell, sparking or a burning smell, someone injured, or (for a vehicle) a crash or someone stranded somewhere unsafe — STOP and tell them warmly but firmly to hang up and call 911 (or roadside assistance / their gas company) right now. Their safety comes first; we'll gladly help once they're safe. Never troubleshoot a hazard over the phone.

HOW YOU RUN THE CALL:
1) Warm open — you've already greeted them. Find out what's going on, one question at a time. Let them tell the story; show you get it ("Oh no, that's no fun — let's get you taken care of").
2) ${capture}
3) ALWAYS read the callback number back digit by digit before you capture it — "let me make sure I've got your number right: five-five-five, one-two-three-four — is that right?" — and fix it if they correct you. The lead is worthless if the number is wrong, so never skip this. Once you've got their name, the CONFIRMED callback number, and what they need, CAPTURE THE LEAD — say a short natural line first ("Perfect, let me get this over to ${owner} right now"), THEN use the capture_lead tool. Never go silent while a tool runs; keep talking warmly.
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
  return `Thanks for calling ${shop.name} — this is ${shop.botName || 'Ant'}. We're here for you around the clock. How can I help you today?`;
}

function webhookTool(name, description, url, properties, required) {
  return { type: 'webhook', webhook: { name, description, url, method: 'POST', body_parameters: { type: 'object', properties, required: required || [] } } };
}

function buildTools(shop, toolKey) {
  const isAuto = shop.type === 'automotive';
  const isDealer = shop.type === 'dealership';
  // base always already carries `?do=<tool>`, so append with & (NOT ? — a second ? here
  // was silently breaking the shop param, so capture_lead never resolved a shop -> no lead).
  const q = (base) => base + `&shop=${encodeURIComponent(shop.slug)}` + (toolKey ? `&k=${encodeURIComponent(toolKey)}` : '');

  const leadProps = isDealer
    ? {
      name: { type: 'string', description: "the caller's name" },
      phone: { type: 'string', description: 'best callback number, digits' },
      vehicle: { type: 'string', description: 'what they\'re looking for — e.g. "cargo work van, Ford Transit, mid-size"' },
      budget: { type: 'string', description: 'rough budget or monthly payment target (optional)' },
      financing: { type: 'string', description: 'do they need financing? (optional)' },
      trade_in: { type: 'string', description: 'any trade-in vehicle they mentioned (optional)' },
      city: { type: 'string', description: 'their city (optional)' },
    }
    : isAuto
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
      isDealer
        ? "Send the buyer's lead straight to the lot owner's phone. Use once you have their name, callback number, and what vehicle they're looking for (plus budget, financing, or trade-in if they shared). This is how the lead reaches the lot — always do it before ending a call with a real buyer."
        : isAuto
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
    name: `${shop.botName || 'Ant'} — ${shop.name} (trial)`,
    model: MODEL,
    instructions: buildInstructions(shop),
    greeting: defaultGreeting(shop),
    description: `${shop.name} phone AI (free trial) — answers 24/7, captures the lead, texts it to the owner.`,
    voice_settings: { voice: shop.voice || VOICE_BROOKE, voice_speed: 1.0 },
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
    // voices — list the TTS voices Telnyx offers (so we can pick a male one for "Ant").
    //   ?action=voices[&gender=male][&provider=Inworld]
    if (action === 'voices') {
      const r = await call('GET', '/text-to-speech/voices');
      let list = (r.data && (r.data.data || r.data.voices)) || (Array.isArray(r.data) ? r.data : []);
      if (!Array.isArray(list)) list = [];
      const g = String(q.gender || '').toLowerCase();
      const prov = String(q.provider || '').toLowerCase();
      const norm = list.map((v) => ({ id: v.id || v.name || v.voice, name: v.name || v.label || v.display_name, provider: v.provider, gender: v.gender || (v.labels && v.labels.gender), language: v.language || (v.labels && v.labels.language) }));
      let out = norm;
      if (g) out = out.filter((v) => String(v.gender || '').toLowerCase() === g);
      if (prov) out = out.filter((v) => String(v.provider || '').toLowerCase().includes(prov));
      const lang = String(q.lang || '').toLowerCase();
      if (lang) out = out.filter((v) => String(v.language || '').toLowerCase().includes(lang));
      const nq = String(q.q || '').toLowerCase();
      if (nq) out = out.filter((v) => String(v.id || '').toLowerCase().includes(nq) || String(v.name || '').toLowerCase().includes(nq));
      return json(200, { ok: r.ok, status: r.status, total: list.length, filtered: out.length, voices: out.slice(0, 120), raw_sample: list.slice(0, 2) });
    }
    // telnyx_costs — REAL spend from Telnyx detail records (calls + SMS), aggregated by
    // number so we can attribute actual $ per shop. ?action=telnyx_costs[&days=30]
    if (action === 'telnyx_costs') {
      const days = Number(q.days) > 0 ? Number(q.days) : 30;
      const since = Date.now() - days * 86400000;
      const amt = (c) => { if (c == null) return 0; if (typeof c === 'number') return c; if (typeof c === 'string') return parseFloat(c) || 0; if (typeof c === 'object') return parseFloat(c.amount || c.total || 0) || 0; return 0; };
      const perType = {}; const perNumber = {};
      const types = String(q.types || 'messaging,voice').split(',').map((s) => s.trim()).filter(Boolean);
      const maxPages = Number(q.pages) > 0 ? Math.min(Number(q.pages), 3) : 2;   // per type; stay under 26s
      let scanned = 0; let sample = null;
      for (const rt of types) {
        let path = `/detail_records?filter[record_type]=${encodeURIComponent(rt)}&page[size]=250&sort=-created_at`;
        let pages = 0; let stop = false;
        while (path && pages < maxPages && !stop) {
          const r = await Promise.race([
            call('GET', path),
            new Promise((res) => setTimeout(() => res({ ok: false, status: 0, data: { _timeout: true } }), 8000)),
          ]);
          if (r.data && r.data._timeout) { stop = true; break; }
          if (!r.ok) { perType['_error_' + rt] = { count: 0, cost: 0, note: JSON.stringify(r.data).slice(0, 120) }; break; }
          const recs = (r.data && r.data.data) || [];
          if (!sample && recs.length) sample = recs.slice(0, 2);
          for (const rec of recs) {
            scanned++;
            const when = Date.parse(rec.created_at || rec.started_at || rec.completed_at || rec.date || rec.occurred_at || '') || 0;
            if (when && when < since) { stop = true; break; }
            const cost = amt(rec.cost) + amt(rec.carrier_fee);   // base + carrier fee = true billed
            perType[rt] = perType[rt] || { count: 0, cost: 0 };
            perType[rt].count++; perType[rt].cost += cost;
            // messaging uses cld/cli; voice uses to/from — cover both
            const num = rec.cld || rec.to || rec.destination_number || rec.cli || rec.from || rec.source_number || '';
            if (num) { perNumber[num] = perNumber[num] || { count: 0, cost: 0 }; perNumber[num].count++; perNumber[num].cost += cost; }
          }
          const meta = (r.data && r.data.meta) || {};
          const pageNum = meta.page_number; const totalPages = meta.total_pages;
          pages++;
          if (pageNum && totalPages && pageNum < totalPages) path = `/detail_records?filter[record_type]=${encodeURIComponent(rt)}&page[size]=250&page[number]=${pageNum + 1}&sort=-created_at`;
          else path = null;
        }
      }
      const totalCost = Object.values(perType).reduce((s, x) => s + x.cost, 0);
      const topNumbers = Object.entries(perNumber).map(([n, v]) => ({ number: n, records: v.count, cost: Math.round(v.cost * 100) / 100 })).sort((a, b) => b.cost - a.cost).slice(0, 40);
      return json(200, { ok: true, days, scanned, types, total_cost: Math.round(totalCost * 100) / 100, by_type: perType, by_number: topNumbers, sample });
    }
    if (action === 'list') return json(200, await call('GET', '/ai/assistants?page[size]=20'));
    if (action === 'get') return json(200, await call('GET', `/ai/assistants/${q.id}`));
    if (action === 'delete') return json(200, await call('DELETE', `/ai/assistants/${q.id}`));
    // Change ONLY the voice on an existing assistant — a partial PATCH that leaves the
    // persona / greeting / tools untouched. Defaults to Brooke.  ?action=setvoice&id=<id>[&voice=Inworld.Max.Brooke]
    if (action === 'setvoice') {
      if (!q.id) return json(200, { ok: false, error: 'need ?id=' });
      const voice = q.voice || VOICE_BROOKE;
      const res = await call('PATCH', `/ai/assistants/${q.id}`, { voice_settings: { voice, voice_speed: 1.0 } });
      const a = res.data && (res.data.data || res.data);
      return json(200, { ok: res.ok, status: res.status, voice, now: a && (a.voice_settings || {}).voice });
    }

    // calls — did a given number get any calls? Read-only Telnyx detail-record check so
    // we can confirm a trial/test line was actually dialed. ?action=calls&number=+18046061234[&days=3]
    if (action === 'calls') {
      const want = String(q.number || '').replace(/\D/g, '');
      if (!want) return json(200, { ok: false, error: 'need ?number=' });
      const days = Number(q.days) > 0 ? Number(q.days) : 3;
      const since = Date.now() - days * 86400000;
      const norm = (s) => String(s || '').replace(/\D/g, '');
      const hit = (n) => { const d = norm(n); return d && (d === want || d.endsWith(want) || want.endsWith(d)); };
      const out = [];
      let path = `/detail_records?filter[record_type]=voice&page[size]=250&sort=-created_at`;
      let pages = 0;
      while (path && pages < 3) {
        const r = await Promise.race([
          call('GET', path),
          new Promise((res) => setTimeout(() => res({ ok: false, status: 0, data: { _timeout: true } }), 8000)),
        ]);
        if (!r.ok || (r.data && r.data._timeout)) break;
        const recs = (r.data && r.data.data) || [];
        let stop = false;
        for (const rec of recs) {
          const when = Date.parse(rec.created_at || rec.started_at || rec.completed_at || '') || 0;
          if (when && when < since) { stop = true; break; }
          if (hit(rec.cld) || hit(rec.to) || hit(rec.destination_number) || hit(rec.cli) || hit(rec.from) || hit(rec.source_number)) {
            out.push({ at: rec.started_at || rec.created_at, from: rec.cli || rec.from || rec.source_number, to: rec.cld || rec.to || rec.destination_number, secs: rec.duration_secs || rec.billed_sec || 0, status: rec.status || rec.hangup_cause || '' });
          }
        }
        const meta = (r.data && r.data.meta) || {};
        pages++;
        if (!stop && meta.page_number && meta.total_pages && meta.page_number < meta.total_pages) path = `/detail_records?filter[record_type]=voice&page[size]=250&page[number]=${meta.page_number + 1}&sort=-created_at`;
        else path = null;
      }
      return json(200, { ok: true, number: want, days, call_count: out.length, calls: out.slice(0, 25) });
    }

    // numbers — list every Telnyx number we own + how it's wired, so we can spot a
    // spare to use as a demo line. ?action=numbers
    if (action === 'numbers') {
      const out = [];
      let page = 1;
      while (page <= 5) {
        const r = await call('GET', `/phone_numbers?page[size]=100&page[number]=${page}`);
        if (!r.ok) break;
        const rows = (r.data && r.data.data) || [];
        if (!rows.length) break;
        for (const n of rows) {
          out.push({
            number: n.phone_number,
            status: n.status,
            connection_id: n.connection_id || null,
            messaging_profile_id: n.messaging_profile_id || null,
            tags: n.tags || [],
            name: n.customer_reference || n.external_pin || '',
          });
        }
        const meta = (r.data && r.data.meta) || {};
        if (meta.page_number && meta.total_pages && meta.page_number < meta.total_pages) page++;
        else break;
      }
      const noVoice = out.filter((n) => !n.connection_id);
      return json(200, { ok: true, total: out.length, without_voice_connection: noVoice.length, spare_candidates: noVoice.slice(0, 20), all: out });
    }

    // convos — AI-assistant conversation log (the RIGHT place for AI-answered calls;
    // classic voice CDRs don't capture these). ?action=convos&id=<assistant-id>[&days=7]
    if (action === 'convos') {
      if (!q.id) return json(200, { ok: false, error: 'need ?id=' });
      // Pull the recent AI-conversation log unfiltered, then match this assistant
      // client-side (the server-side filter param names vary by Telnyx version).
      const r = await call('GET', `/ai/conversations?page[size]=100`);
      if (!r.ok) return json(200, { ok: false, status: r.status, err: JSON.stringify(r.data).slice(0, 300) });
      const all = (r.data && r.data.data) || [];
      const idStr = String(q.id);
      const mine = all.filter((c) => JSON.stringify(c).includes(idStr));
      const shape = (c) => ({
        id: c.id || c.conversation_id,
        at: c.last_message_at || c.created_at || c.started_at,
        assistant: c.assistant_id || (c.metadata && c.metadata.assistant_id),
        from: (c.metadata && (c.metadata.from || c.metadata.caller || c.metadata.telnyx_end_user_target)) || c.from || '',
        msgs: c.message_count,
      });
      return json(200, {
        ok: true,
        total_in_log: all.length,
        matched_this_assistant: mine.length,
        conversations: mine.slice(0, 40).map(shape),
        raw_sample: all.slice(0, 1),
      });
    }

    // add_shop — register a NEW shop's config in the data-driven store (Supabase),
    // so a shop can be stood up on a call with NO code edit + deploy. Idempotent by slug
    // (re-send to update fields). Only the params you pass are written (merged over any
    // existing config), so you can add the `about` later without wiping the rest.
    if (action === 'add_shop') {
      const slug = String(q.slug || '').toLowerCase().trim();
      if (!slug) return json(200, { ok: false, error: 'need ?slug=' });
      // required on first create; a later add_shop can omit them (merge keeps them)
      const patch = {};
      const map = {
        name: 'name', type: 'type', owner_first: 'ownerFirst', owner_cell: 'ownerCell',
        area: 'area', hours: 'hours', about: 'about', email: 'email',
        auto_scope: 'autoScope', greeting: 'greeting', platform_slug: 'platformSlug',
        ann_number: 'annNumber', voice: 'voice', bot_name: 'botName',
      };
      for (const k of Object.keys(map)) { if (q[k] != null && q[k] !== '') patch[map[k]] = String(q[k]); }
      if (patch.ownerCell) { const d = patch.ownerCell.replace(/[^\d+]/g, ''); patch.ownerCell = d.startsWith('+') ? d : (d.length === 10 ? '+1' + d : (d.length === 11 && d[0] === '1' ? '+' + d : d)); }
      if (q.plan_price != null && q.plan_price !== '') patch.planPrice = Number(q.plan_price) || 0;
      // sanity: a brand-new shop needs at least name + a valid owner cell
      let existing = null; try { existing = await shops.getAsync(slug); } catch (_) {}
      if (!existing && (!patch.name || !patch.ownerCell)) {
        return json(200, { ok: false, error: 'a new shop needs at least &name= and &owner_cell=' });
      }
      if (existing && existing._source === 'file') {
        return json(200, { ok: false, error: 'slug "' + slug + '" is a curated file shop — edit it in _lib/trial-shops.js, not the store' });
      }
      try {
        const saved = await shops.putStore(slug, patch);
        return json(200, { ok: true, slug, shop: saved, next: `trial-ann-admin?action=create&shop=${slug}&secret=… -> then &action=bind&id=<assistant_id>&number=+1…` });
      } catch (e) { return json(200, { ok: false, error: 'store write failed: ' + String((e && e.message) || e) }); }
    }

    // list store-backed shops (curated file shops aren't listed here)
    if (action === 'shops') return json(200, { ok: true, shops: await shops.listStore() });

    if (action === 'create' || action === 'update') {
      const shop = await shops.getAsync(q.shop);
      if (!shop) return json(200, { ok: false, error: 'unknown shop: ' + (q.shop || '') + ' — add it first via ?action=add_shop (or _lib/trial-shops.js)' });
      if (!shop.name || !shop.ownerCell) return json(200, { ok: false, error: 'shop needs at least name + ownerCell (set via add_shop)' });
      shop.slug = String(q.shop).toLowerCase().trim();
      const toolKey = q.tool_key || (await getSecret('TELNYX_TOOL_SECRET')) || '';
      if (action === 'update') {
        if (!q.id) return json(200, { ok: false, error: 'need ?id=' });
        const res = await call('PATCH', `/ai/assistants/${q.id}`, assistantBody(shop, toolKey));
        return json(200, { ok: res.ok, status: res.status, shop: shop.name, response: res.data });
      }
      const res = await call('POST', '/ai/assistants', assistantBody(shop, toolKey));
      const id = res.data && (res.data.id || (res.data.data && res.data.data.id));
      // Persist the assistant_id back to the store so it survives without a code edit
      // (curated file shops are hand-maintained, so only store-backed shops get written).
      if (id && shop._source === 'store') { try { await shops.putStore(shop.slug, { assistantId: id }); } catch (_) {} }
      return json(200, { ok: res.ok, status: res.status, shop: shop.name, type: shop.type, assistant_id: id || null, response: res.data });
    }

    if (action === 'bind') {
      // Route a phone number's inbound to the assistant by pointing the number's
      // connection_id at the assistant's own TeXML app (telephony_settings.
      // default_texml_app_id). The old /ai/assistants/{id}/phone_numbers endpoint 404s.
      const id = q.id; const number = q.number;
      if (!id || !number) return json(200, { ok: false, error: 'need ?id= and ?number=+1...' });
      const a = await call('GET', `/ai/assistants/${id}`);
      const conn = a.data && a.data.telephony_settings && a.data.telephony_settings.default_texml_app_id;
      if (!conn) return json(200, { ok: false, error: 'no default_texml_app_id on assistant', assistant: a.status });
      const pn = await call('GET', `/phone_numbers?filter[phone_number]=${encodeURIComponent(number)}`);
      const rec = pn.data && pn.data.data && pn.data.data[0];
      if (!rec) return json(200, { ok: false, error: 'number not found on Telnyx (still provisioning?)' });
      const up = await call('PATCH', `/phone_numbers/${rec.id}`, { connection_id: conn });
      // If a store-backed shop slug was passed, remember its Ann number (best-effort).
      if (up.ok && q.shop) { try { const s = await shops.getAsync(q.shop); if (s && s._source === 'store') await shops.putStore(q.shop, { annNumber: number }); } catch (_) {} }
      return json(200, { ok: up.ok, bound: up.ok ? number : null, points_to: conn, status: up.status, error: up.ok ? undefined : JSON.stringify((up.data && up.data.errors) || up.data).slice(0, 300) });
    }

    return json(200, { ok: false, error: 'unknown action', actions: ['add_shop', 'shops', 'create', 'update', 'bind', 'get', 'delete', 'list'] });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
