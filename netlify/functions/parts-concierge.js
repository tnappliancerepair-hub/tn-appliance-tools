// parts-concierge — the "I already know my part" door (Option A). A confident/DIY
// customer who knows their model# submits it in THEIR language; a human (Danielle/
// Teddy) confirms the exact part and texts back a buy link. The two-way translator
// makes it work in any language: we translate the request INTO English for the office,
// remember the customer's language, drop it in the shared thread (so the office can
// reply in English and it goes back translated), and ack the customer in their language.
//
//   POST { name, phone, appliance, model, problem, lang? }
//     -> { ok, language, english }
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');
const { translateToEnglish, translateTo } = require('./_lib/translate');
const { setCustomerLang } = require('./_lib/customer-lang');

const OWNER = '+16154855795';       // Teddy (alert TO Teddy is fine; never put his cell in a customer body)
const DANIELLE = '+16154850713';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; return String(p || '').startsWith('+') ? String(p) : ''; }

// Customer-facing acknowledgement per language name (fallback: translate from English).
const ACK_EN = "Got it! A real appliance tech is finding the exact part for your {appl} now. We'll text you the part and the price shortly — reply here any time. — TN Appliance Exchange";

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const name = String(b.name || '').trim().slice(0, 80);
  const phone = e164(b.phone);
  const appliance = String(b.appliance || '').trim().slice(0, 40) || 'appliance';
  const model = String(b.model || '').trim().slice(0, 60);
  const problem = String(b.problem || '').trim().slice(0, 800);
  const hintLang = String(b.lang || '').trim().toLowerCase();
  if (!phone || phone.replace(/\D/g, '').length < 11) return json(400, { ok: false, error: 'valid phone required' });
  if (!model && !problem) return json(400, { ok: false, error: 'model or problem required' });

  // 1) Translate the request INTO English for the office + detect the language.
  let engProblem = problem, code = hintLang || 'en';
  try {
    const tr = await translateToEnglish(problem || model);
    if (tr) {
      if (problem && tr.english) engProblem = tr.english;
      if (!hintLang && tr.code) code = tr.code;      // trust the form's ?lang if present
    }
  } catch (_) {}
  if (!code) code = 'en';

  // 2) Remember the customer's language so every future reply auto-translates back.
  try { await setCustomerLang(phone, code); } catch (_) {}

  const origLine = `🔧 Part request — ${appliance}${model ? ' · model ' + model : ''}${problem ? ': ' + problem : ''}`;
  const engLine = `🔧 Part request — ${appliance}${model ? ' · model ' + model : ''}${engProblem ? ': ' + engProblem : ''}`;

  // 3) Drop it in the shared per-job thread (by phone) so the office can reply in
  //    English → it goes back in the customer's language. english = office gloss.
  try {
    await crud.logEvent('inbound_customer_sms_received', {
      phone, from: phone, to: 'parts_concierge', body: origLine, message: origLine,
      english: (code !== 'en' && engLine !== origLine) ? engLine : undefined, lang: code !== 'en' ? code : undefined,
      source: 'parts_concierge', lane: 'human', has_media: false, at_ms: Date.now(),
    });
  } catch (_) {}
  // Lead marker for tracking / the board.
  try { await crud.logEvent('parts_concierge_request', { phone, name, appliance, model, problem: engProblem, lang: code, at_ms: Date.now() }); } catch (_) {}

  // 4) Alert Teddy + Danielle in English with the exact info to source the part.
  const langName = ({ es: 'Spanish', vi: 'Vietnamese', ru: 'Russian', zh: 'Chinese', ar: 'Arabic', hi: 'Hindi', fr: 'French' })[code] || 'English';
  const alert = `🔧 PART REQUEST${code !== 'en' ? ' (' + langName + ')' : ''} — ${name || 'customer'} · ${phone}\n${appliance}${model ? ' · model ' + model : ''}\n"${engProblem || '(no detail)'}"\n\nConfirm the exact part + text a buy link. Reply in the board thread in English — it goes back in ${langName}.`;
  try { await sendSms(OWNER, alert, 'owner', 'parts_concierge_lead'); } catch (_) {}
  try { await sendSms(DANIELLE, alert, 'warranty_handler', 'parts_concierge_lead'); } catch (_) {}

  // 5) Ack the customer in THEIR language (reactive → allowed).
  const ackEn = ACK_EN.replace('{appl}', appliance);
  let ackOut = ackEn;
  try { if (code !== 'en') ackOut = await translateTo(ackEn, code); } catch (_) {}
  const SITE = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://tnapplianceexchange.net';
  let sent = false;
  try {
    const r = await fetch(`${SITE}/.netlify/functions/human-line-send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message: ackOut, sender: 'Ant', job_id: 0 }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => ({})); sent = !!(d && d.sent);
  } catch (_) {}

  return json(200, { ok: true, language: langName, code, english: engProblem, ack_sent: sent });
};
