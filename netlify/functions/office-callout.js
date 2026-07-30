// office-callout — click-to-call bridge for the office. The office taps "Call" on
// a customer; Telnyx rings the office person's CELL first, and when they answer it
// dials the customer and bridges them (office-callout-texml). Works on any device
// (desktop, phone) — no softphone, no mic, no dead `tel:` link. Customer sees the
// shop number as caller ID.
//
//   POST { password, to, who? }
//     password  office password (verified via Xano verify_office_password)
//     to        customer phone (any format; normalized to E.164)
//     who       'teddy' | 'danielle' (whose cell rings). Default danielle.
//
// Reuses the existing "Ant Office Ring Group" TeXML application (it already has an
// outbound voice profile). The app id is resolved by name at runtime unless
// TELNYX_TEXML_APP_ID is set. Returns { ok, call_sid } or a clear error.
'use strict';
const { getSecret } = require('./_lib/secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TELNYX = 'https://api.telnyx.com/v2';
const SITE = 'https://tnapplianceexchange.net';

function json(code, body) { return { statusCode: code, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) }; }
function e164(v) {
  let d = String(v || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return /^\+\d{8,15}$/.test(d) ? d : '';
  d = d.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return '';
}
async function verifyOffice(password) {
  if (!password) return false;
  try {
    const r = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => ({}));
    return !!(d && (d.valid || d.success || d.ok));
  } catch (_) { return false; }
}
async function resolveTexmlAppId(KEY) {
  const stored = await getSecret('TELNYX_TEXML_APP_ID');
  if (stored) return stored;
  try {
    const r = await fetch(`${TELNYX}/texml_applications?page[size]=100`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(12000) });
    const d = await r.json().catch(() => ({}));
    const app = (d.data || []).find((a) => a.friendly_name === 'Ant Office Ring Group') || (d.data || []).find((a) => /ring group|office/i.test(a.friendly_name || ''));
    return app ? app.id : '';
  } catch (_) { return ''; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method' });

  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  if (!(await verifyOffice(b.password))) return json(401, { ok: false, error: 'unauthorized' });

  const customer = e164(b.to);
  if (!customer) return json(400, { ok: false, error: 'no valid customer number' });

  const who = String(b.who || 'danielle').toLowerCase();
  const cell = who === 'teddy'
    ? ((await getSecret('OFFICE_CELL_TEDDY')) || '+16154855795')
    : ((await getSecret('OFFICE_CELL_DANIELLE')) || '+16154850713');
  const from = (await getSecret('TELNYX_OFFICE_CUSTOMER_NUMBER')) || (await getSecret('TELNYX_OFFICE_CALLER_NUMBER')) || '+16155889500';

  const KEY = await getSecret('TELNYX_API_KEY');
  if (!KEY) return json(200, { ok: false, error: 'telnyx not configured' });
  const appId = await resolveTexmlAppId(KEY);
  if (!appId) return json(200, { ok: false, error: 'no TeXML app found (Ant Office Ring Group)' });

  // Originate the A-leg to the office cell. On answer, Telnyx fetches Url (which
  // dials + bridges the customer). answerOnBridge in the TeXML keeps it clean.
  const callUrl = `${SITE}/.netlify/functions/office-callout-texml?to=${encodeURIComponent(customer)}`;
  try {
    const r = await fetch(`${TELNYX}/texml/calls/${appId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ To: cell, From: from, Url: callUrl, UrlMethod: 'GET' }),
      signal: AbortSignal.timeout(12000),
    });
    const raw = await r.text();
    let d = {}; try { d = JSON.parse(raw); } catch (_) {}
    if (!r.ok) return json(200, { ok: false, error: 'telnyx_error', status: r.status, detail: raw.slice(0, 300) });
    const sid = (d && (d.call_sid || d.sid || (d.data && (d.data.call_sid || d.data.call_control_id)))) || '';
    try { await require('./_lib/xano/metadata-crud').logEvent('office_callout_bridge', { to: customer, ringing: cell, who, call_sid: sid, actor: b.actor || who }); } catch (_) {}
    return json(200, { ok: true, call_sid: sid, ringing: cell });
  } catch (e) {
    return json(200, { ok: false, error: 'originate_failed', detail: String((e && e.message) || e) });
  }
};
