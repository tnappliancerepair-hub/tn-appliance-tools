// platform-precall — greet the caller BY NAME, already knowing their job (multi-tenant).
//
// Wired as a shop's Telnyx AI Assistant "Dynamic Variables webhook". At pickup — BEFORE Ann
// speaks — Telnyx POSTs the call context here; we look the caller up on THAT shop's board and
// return { dynamic_variables:{ greeting, situation, system_context, ... } }. Ann's first words
// become "Hi Angela — I see you're scheduled Thursday with Joey for your dishwasher — is that
// what you're calling about?" instead of "Can I get your name?".
//
// Multi-tenant trick: the SHOP is baked into this webhook's URL (?slug=<board>&k=<key>) at
// assistant-build time — so no dialed-number→shop map is needed. Telnyx still hands us the
// CALLER's number, which is all we resolve.
//
// Reuses the ONE brain (platform-call-brain do=lookup) so the phrasing has a single source.
// Runs OFF the call path during pickup; HARD-CAPPED at ~1.8s (Telnyx drops the webhook after a
// couple seconds and would speak the literal "{{greeting}}"), and BULLETPROOF — any failure
// returns a warm generic greeting (HTTP 200), never a dead/silent call.
//
//   POST (Telnyx) ?slug=<board>&k=<key>   { data:{ payload:{ telnyx_end_user_target, to } } }
//   GET  ?slug=demo&phone=+16155550103    (test harness — same shape, easy to eyeball)
'use strict';

const { getSecret } = require('./_lib/secrets');
const SITE = 'https://tnapplianceexchange.net';
const BRAIN = `${SITE}/.netlify/functions/platform-call-brain`;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

// Netlify base64-encodes POST bodies — decode before parse or the caller ID is lost.
function rawBody(event) {
  let b = event.body || '';
  if (event.isBase64Encoded && b) { try { b = Buffer.from(b, 'base64').toString('utf8'); } catch (_) {} }
  return b;
}
// Telnyx tucks the caller number in a few spots; the real inbound field is
// data.payload.telnyx_end_user_target.
function callerFrom(body, q) {
  if (q && q.phone) return q.phone;
  const b = body || {};
  const c = [
    b.from, b.caller, b.telnyx_end_user_target,
    b.data && b.data.payload && b.data.payload.telnyx_end_user_target,
    b.payload && b.payload.telnyx_end_user_target,
    b.data && b.data.payload && b.data.payload.from,
    b.data && b.data.payload && b.data.payload.from && b.data.payload.from.phone_number,
    b.payload && b.payload.from,
    b.call && b.call.from,
  ];
  for (const v of c) {
    if (!v) continue;
    if (typeof v === 'string' && v.replace(/\D/g, '').length >= 10) return v;
    if (v && v.phone_number) return v.phone_number;
  }
  return '';
}

// warm generic — used for an unknown caller OR any hiccup, so the call never waits on us.
function generic(shop) {
  const s = shop || 'us';
  return {
    known: false, caller_first: '',
    greeting: `Thanks for calling ${s} — we're here for you around the clock. Who do I have the pleasure of speaking with?`,
    situation: '', has_job: false, job_id: '', is_warranty: false,
    system_context: 'The caller is not yet identified. Warmly ask their name and how you can help, then use the get_status tool with their phone number, name, or claim number to pull up their job.',
  };
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const slug = String(q.slug || '').toLowerCase().trim();
  // Bulletproof: never fail a call. Any throw → warm generic (200).
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
    let body = {}; try { body = JSON.parse(rawBody(event) || '{}'); } catch (_) {}
    const from = callerFrom(body, q);
    const digits = String(from || '').replace(/\D/g, '');

    if (!slug) return json(200, { dynamic_variables: generic(''), matched: false, reason: 'no_slug' });
    if (!digits || digits.length < 10) return json(200, { dynamic_variables: generic(''), matched: false, reason: 'no_caller_id' });

    // ONE call to the brain, racing a hard 1.8s deadline. If it loses, warm generic — a real
    // greeting, never the literal "{{greeting}}".
    const kq = q.k ? `&k=${encodeURIComponent(q.k)}` : '';
    const url = `${BRAIN}?do=lookup&slug=${encodeURIComponent(slug)}&phone=${encodeURIComponent(digits)}${kq}`;
    const TIMED = Symbol('t');
    const lookup = fetch(url, { signal: AbortSignal.timeout(1700) }).then((r) => r.json()).catch(() => null);
    const raced = await Promise.race([lookup, new Promise((res) => setTimeout(() => res(TIMED), 1800))]);
    const d = raced === TIMED ? null : raced;

    const shop = (d && d.shop) || '';
    if (!d || !d.ok || !d.found) {
      return json(200, { dynamic_variables: generic(shop), matched: false, reason: (raced === TIMED) ? 'slow' : 'no_match' });
    }

    const first = (d.customer && (d.customer.first_name || '').trim()) || '';
    const situation = (d.situation || '').trim();
    const j = d.job || null;
    const hi = first ? `Hi ${first}!` : 'Thanks for calling!';
    const shopBit = shop ? ` Thanks for calling ${shop}.` : '';
    let greeting;
    if (situation) greeting = `${hi}${shopBit} I see ${situation} — is that what you're calling about, or is it something else?`;
    else greeting = `${hi}${shopBit} How can I help you today?`;

    // full context so Ann "already knows" for the whole call, not just the greeting
    const bits = [
      first && `Caller: ${first}.`,
      j && j.unit_label && `Appliance/unit: ${j.unit_label}.`,
      j && j.status && `Job status: ${j.status}.`,
      j && j.tech_first && `Assigned tech: ${j.tech_first}.`,
      j && j.scheduled_day && `Scheduled day: ${j.scheduled_day} (day-of routing — never quote a clock time; a live arrival window goes out that morning).`,
      j && j.parts_eta && `Part ETA: ${j.parts_eta}.`,
      j && j.warranty_company && `Warranty job (${j.warranty_company}).`,
      j && j.problem && `Reported problem: ${j.problem}.`,
      `You already have this from the board. Confirm gently and use get_status if they ask for a refresh; never read a homeowner a part or claim number.`,
    ].filter(Boolean);

    const dv = {
      known: true, caller_first: first, greeting, situation,
      has_job: !!(j && j.id), job_id: String((j && j.id) || ''),
      appliance: (j && j.unit_label) || '', tech: (j && j.tech_first) || '',
      scheduled_day: (j && j.scheduled_day) || '', status: (j && j.status) || '',
      is_warranty: !!(j && j.warranty_company), warranty_company: (j && j.warranty_company) || '',
      system_context: bits.join(' '),
    };
    return json(200, { dynamic_variables: dv, matched: true, job_id: dv.job_id });
  } catch (e) {
    return json(200, { dynamic_variables: generic(''), matched: false, reason: 'error_fallback' });
  }
};
