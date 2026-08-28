// platform-phone — self-serve "Turn on my AI receptionist." On the wizard button tap, this
// provisions a phone line + Ann for ONE tenant, on OUR Telnyx account (the shop never sees
// Telnyx). Hybrid texting: the new number attaches to a SHARED, pre-registered 10DLC messaging
// profile so texting works day one; graduate a shop to its own campaign later.
//
//   POST { action:'provision', access_token | secret, company_id?, mode:'buy'|'forward', area? }
//        -> buys a number near the shop's area code, attaches it to the shared messaging
//           profile, creates + binds Ann (trade persona + the shop's "about"), writes
//           company.settings.phone. Voice answers immediately.
//   POST { action:'status'  } -> the tenant's phone state
//   POST { action:'release' } -> release the number + delete the assistant (on churn)
//
// SHADOW by default: with PLATFORM_PHONE_LIVE != true it does everything EXCEPT spend money —
// returns the exact plan (what it WOULD buy/create) so the flow is testable for free. Flip
// PLATFORM_PHONE_LIVE=true + set TELNYX_SHARED_MESSAGING_PROFILE_ID to go live.
'use strict';

const { getSecret } = require('./_lib/secrets');
const { platform } = require('./_lib/platform-rest');
const meter = require('./_lib/usage-meter');

const TELNYX = 'https://api.telnyx.com/v2';
const SITE = 'https://tnapplianceexchange.net';
const LEAD_TOOL = SITE + '/.netlify/functions/platform-lead';
const VOICE_BROOKE = 'Inworld.Max.Brooke';
const MODEL = 'openai/gpt-5.4';

function J(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

async function tx(method, path, body) {
  const key = process.env.TELNYX_API_KEY || (await getSecret('TELNYX_API_KEY'));
  const r = await fetch(TELNYX + path, {
    method, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: d };
}

// Verify a Supabase session JWT → the user's company (self-serve auth), server-side.
async function companyFromToken(token) {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!url || !key || !token) return null;
  const r = await fetch(url.replace(/\/+$/, '') + '/auth/v1/user', {
    headers: { apikey: key, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  if (!u || !u.id) return null;
  const pf = await platform();
  const rows = await pf.get(`app_user?auth_user_id=eq.${encodeURIComponent(u.id)}&role=eq.owner&select=company_id&limit=1`);
  return (rows && rows[0] && rows[0].company_id) || null;
}

function areaCode(company) {
  const b = (company.settings && company.settings.business) || {};
  const d = String(b.phone || '').replace(/\D/g, '');
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  if (ten.length >= 10) return ten.slice(0, 3);
  return '615'; // sane default (Middle TN)
}

// Ann's persona for a platform tenant — built from the shop's own settings, trade-aware,
// captures the lead straight onto the shop's board via platform-lead.
function assistantBody(company) {
  const name = company.name || 'the shop';
  const ai = (company.settings && company.settings.ai) || {};
  const trade = company.trade || 'appliance';
  const canBook = ai.can_book !== false, canStatus = ai.can_status !== false, canMsg = ai.can_message !== false;
  const about = ai.about ? ('\n\nWhat to know about this shop:\n' + ai.about) : '';
  const instr =
    `You are Ann, the warm, upbeat front-desk voice for ${name}, a ${trade} business. Your ONE job is to help every caller and never let a real lead slip away.` +
    about +
    `\n\nHow you help:` +
    (canBook ? `\n- Book / request an appointment — get their name, best callback number, what they need, and their city/address.` : '') +
    (canStatus ? `\n- Check on an existing job — take their name + number and pass it to the office.` : '') +
    (canMsg ? `\n- Take a message for the office.` : '') +
    `\n\nWhen you have a real caller with a name + callback number + what they need, ALWAYS call capture_lead before ending — that's how the lead reaches ${name}. Be concise, kind, and never make up prices, times, or promises you can't keep. If you don't know, say you'll have the office follow up.`;
  const slug = company.slug || '';
  const q = (p) => `${LEAD_TOOL}?do=${p}&slug=${encodeURIComponent(slug)}`;
  const wh = (n, desc, url, props, req) => ({ type: 'webhook', webhook: { name: n, description: desc, url, method: 'POST', body_parameters: { type: 'object', properties: props, required: req || [] } } });
  return {
    name: `Ann — ${name}`,
    model: MODEL,
    instructions: instr,
    greeting: ai.greeting || `Thanks for calling ${name}, this is Ann — how can I help you today?`,
    description: `${name} phone AI — answers 24/7, captures the lead, sends it to the board.`,
    voice_settings: { voice: ai.voice || VOICE_BROOKE, voice_speed: 1.0 },
    transcription: { model: 'deepgram/flux', language: 'auto' },
    tools: [
      wh('capture_lead',
        `Send the caller's lead straight to ${name}'s board + owner. Use once you have their name, callback number, and what they need. Always do this before ending a call with a real caller.`,
        q('capture_lead'),
        { name: { type: 'string', description: "the caller's name" }, phone: { type: 'string', description: 'best callback number, digits' }, what: { type: 'string', description: 'the appliance/vehicle/item + the problem or service they want' }, detail: { type: 'string', description: 'any extra detail (optional)' }, city: { type: 'string', description: 'their city (optional)' } },
        ['phone']),
      wh('message_owner', `Text a free-form note to ${name}'s owner when something should reach them that isn't a standard lead.`,
        q('message_owner'), { message: { type: 'string', description: 'what to pass along' } }, ['message']),
      { type: 'hangup', hangup: { description: 'End the call politely once everything is handled.' } },
    ],
  };
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return J(405, { ok: false, error: 'POST only' });
  let b = {};
  try { b = event.body ? JSON.parse(event.body) : {}; } catch (_) {}
  const action = String(b.action || 'status').toLowerCase();

  const pf = await platform();
  if (!pf) return J(200, { ok: false, error: 'platform_not_configured' });

  // Auth: a shop's Supabase session token (self-serve) OR the admin secret (testing).
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let companyId = null;
  if (b.secret && b.secret === admin) companyId = b.company_id || null;
  else if (b.access_token) companyId = await companyFromToken(b.access_token);
  if (!companyId) return J(401, { ok: false, error: 'unauthorized' });

  const rows = await pf.get(`company?id=eq.${encodeURIComponent(companyId)}&select=id,name,slug,trade,status,settings,stripe_customer_id&limit=1`);
  const company = rows && rows[0];
  if (!company) return J(404, { ok: false, error: 'company_not_found' });
  const phone = (company.settings && company.settings.phone) || {};

  if (action === 'status') {
    return J(200, { ok: true, phone: { number: phone.number || null, live: !!phone.number && !phone.paused, paused: !!phone.paused, assistant_id: phone.assistant_id || null, mode: phone.mode || null } });
  }

  // Weekly (Mon–Sun) Ann usage vs the 400-min allowance — for the owner dashboard card.
  if (action === 'usage') {
    if (!phone.number) return J(200, { ok: true, has_phone: false });
    let w;
    try { w = meter.weeklyStatus(await meter.weeklyTelnyx(phone.number, phone.assistant_id)); }
    catch (_) { return J(200, { ok: false, error: 'meter_err' }); }
    return J(200, { ok: true, has_phone: true, paused: !!phone.paused, number: phone.number, week: w.week_label, minutes: w.minutes, texts: w.texts, allowance_min: w.allowance_min, pct: w.pct, near: w.near, over: w.over });
  }

  const LIVE = String((await getSecret('PLATFORM_PHONE_LIVE')) || '').toLowerCase() === 'true';

  if (action === 'provision') {
    // Gate: only for a shop with a live subscription (a number costs money).
    if (!['active', 'trial'].includes(String(company.status))) {
      return J(200, { ok: false, error: 'subscription_required', note: 'phone activates on an active/trial (card-on-file) subscription' });
    }
    // Idempotent: already has a number.
    if (phone.number) return J(200, { ok: true, already: true, number: phone.number, assistant_id: phone.assistant_id || null });

    const area = String(b.area || areaCode(company)).replace(/\D/g, '').slice(0, 3) || '615';
    const mode = b.mode === 'forward' ? 'forward' : 'buy';
    const sharedProfile = (await getSecret('TELNYX_SHARED_MESSAGING_PROFILE_ID')) || '';

    // SHADOW — prove the flow for free.
    if (!LIVE) {
      return J(200, { ok: true, shadow: true, plan: {
        would_buy_number_in_area: area, mode,
        attach_messaging_profile: sharedProfile || '(TELNYX_SHARED_MESSAGING_PROFILE_ID not set)',
        create_assistant: 'Ann — ' + company.name, lead_tool: LEAD_TOOL + '?slug=' + (company.slug || ''),
      }, note: 'PLATFORM_PHONE_LIVE!=true — nothing purchased. Set it + the shared profile id to go live.' });
    }

    // LIVE: 1) find + buy a number near their area code (voice + sms capable)
    const search = await tx('GET', `/available_phone_numbers?filter[national_destination_code]=${area}&filter[features][]=voice&filter[features][]=sms&filter[limit]=5&filter[best_effort]=true`);
    const cand = search.data && search.data.data && search.data.data[0] && search.data.data[0].phone_number;
    if (!cand) return J(200, { ok: false, step: 'search', error: 'no numbers available in ' + area });
    const order = await tx('POST', '/number_orders', { phone_numbers: [{ phone_number: cand }] });
    if (!order.ok) return J(200, { ok: false, step: 'order', error: JSON.stringify(order.data.errors || order.data).slice(0, 200) });

    // 2) attach to the shared 10DLC messaging profile (hybrid texting) — best-effort
    let textingOk = false;
    if (sharedProfile) {
      const look = await tx('GET', `/phone_numbers?filter[phone_number]=${encodeURIComponent(cand)}`);
      const rec = look.data && look.data.data && look.data.data[0];
      if (rec) { const m = await tx('PATCH', `/phone_numbers/${rec.id}/messaging`, { messaging_profile_id: sharedProfile }); textingOk = m.ok; }
    }

    // 3) create Ann + bind the number to her TeXML app
    const asst = await tx('POST', '/ai/assistants', assistantBody(company));
    if (!asst.ok) return J(200, { ok: false, step: 'assistant', error: JSON.stringify(asst.data.errors || asst.data).slice(0, 200), number: cand });
    const assistantId = asst.data.id;
    const conn = asst.data.telephony_settings && asst.data.telephony_settings.default_texml_app_id;
    let voiceOk = false;
    if (conn) {
      const look2 = await tx('GET', `/phone_numbers?filter[phone_number]=${encodeURIComponent(cand)}`);
      const rec2 = look2.data && look2.data.data && look2.data.data[0];
      if (rec2) { const bind = await tx('PATCH', `/phone_numbers/${rec2.id}`, { connection_id: conn }); voiceOk = bind.ok; }
    }

    // 4) persist onto the tenant
    const nextSettings = Object.assign({}, company.settings, {
      phone: { number: cand, assistant_id: assistantId, mode, texting: textingOk ? 'shared' : 'pending', provisioned_at: Date.now() },
      ai: Object.assign({}, (company.settings || {}).ai, { phone_requested: true }),
    });
    await pf.patch('company', `id=eq.${encodeURIComponent(companyId)}`, { settings: nextSettings, updated_at: new Date().toISOString() });

    // Start the $50/week Ann subscription NOW (billing-live only) so the flat base bills from the
    // day the phone turns on — not the following Monday. Idempotent + non-fatal (the phone still
    // works even if this hiccups). The weekly biller adds any overage on top.
    let annStarted = false;
    if (String((await getSecret('PLATFORM_BILLING_LIVE')) || '').toLowerCase() === 'true' && company.stripe_customer_id) {
      try {
        const billing = require('./platform-billing');
        const key = await billing.stripeKey();
        if (key) {
          const Stripe = require('stripe');
          const c2 = Object.assign({}, company, { settings: nextSettings });
          const r = await billing.ensureAnnSubscription(pf, new Stripe(key), c2);
          annStarted = !!(r && r.subscription_id);
        }
      } catch (_) {}
    }

    return J(200, { ok: true, number: cand, assistant_id: assistantId, voice_live: voiceOk, texting: textingOk ? 'shared' : 'pending', mode, ann_billing: annStarted });
  }

  // Pause / resume — the owner's toggle to stop (or restart) Ann answering, e.g. after
  // hitting the weekly 400. Pause unbinds the number from Ann's TeXML app so calls stop being
  // AI-answered (keeps the number); resume re-binds. Flag mirrored in settings.phone.paused.
  if (action === 'pause' || action === 'resume') {
    if (!phone.number) return J(200, { ok: false, error: 'no_phone' });
    const paused = action === 'pause';
    if (LIVE && phone.assistant_id) {
      try {
        const look = await tx('GET', `/phone_numbers?filter[phone_number]=${encodeURIComponent(phone.number)}`);
        const rec = look.data && look.data.data && look.data.data[0];
        if (rec) {
          let conn = '';
          if (!paused) { const a = await tx('GET', `/ai/assistants/${phone.assistant_id}`); conn = (a.data.telephony_settings && a.data.telephony_settings.default_texml_app_id) || ''; }
          await tx('PATCH', `/phone_numbers/${rec.id}`, { connection_id: conn || null });
        }
      } catch (_) {}
    }
    const nextSettings = Object.assign({}, company.settings, { phone: Object.assign({}, phone, { paused: paused, paused_at: paused ? Date.now() : null }) });
    await pf.patch('company', `id=eq.${encodeURIComponent(companyId)}`, { settings: nextSettings, updated_at: new Date().toISOString() });
    return J(200, { ok: true, paused: paused, shadow: !LIVE });
  }

  if (action === 'release') {
    if (!phone.number) return J(200, { ok: true, released: false, note: 'no number' });
    if (LIVE) {
      const look = await tx('GET', `/phone_numbers?filter[phone_number]=${encodeURIComponent(phone.number)}`);
      const rec = look.data && look.data.data && look.data.data[0];
      if (rec) await tx('DELETE', `/phone_numbers/${rec.id}`);
      if (phone.assistant_id) await tx('DELETE', `/ai/assistants/${phone.assistant_id}`);
    }
    // Cancel the $50/week Ann subscription so the base stops billing on churn. Non-fatal.
    let annCanceled = false;
    if (phone.ann && phone.ann.subscription_id) {
      try {
        const billing = require('./platform-billing');
        const key = await billing.stripeKey();
        if (key) { await new (require('stripe'))(key).subscriptions.cancel(phone.ann.subscription_id); annCanceled = true; }
      } catch (_) {}
    }
    const nextPhone = Object.assign({}, phone, { number: null, released_at: Date.now() });
    if (annCanceled) delete nextPhone.ann;
    const nextSettings = Object.assign({}, company.settings, { phone: nextPhone });
    await pf.patch('company', `id=eq.${encodeURIComponent(companyId)}`, { settings: nextSettings, updated_at: new Date().toISOString() });
    return J(200, { ok: true, released: true, ann_canceled: annCanceled, shadow: !LIVE });
  }

  return J(400, { ok: false, error: 'unknown_action', actions: ['provision', 'status', 'pause', 'resume', 'release'] });
};
