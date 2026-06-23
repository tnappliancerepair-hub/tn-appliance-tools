// telnyx-webrtc-token — mints a short-lived WebRTC login token for the Ant
// Office Phone (office-phone.html). The browser SDK (@telnyx/webrtc) logs in
// with this JWT instead of a raw SIP password, so no SIP secret ever touches
// the client.
//
// Flow: office-phone.html POSTs { password } -> we verify it against Xano's
// verify_office_password -> mint a token from the configured Telnyx on-demand
// credential -> return { ok, token, caller_number }.
//
// Required Netlify env (Teddy sets these once after the Telnyx portal setup):
//   TELNYX_API_KEY                — Telnyx V2 API key (Bearer)
//   TELNYX_WEBRTC_CREDENTIAL_ID   — the on-demand credential's id (under the
//                                   Credential Connection the office phone uses)
//   TELNYX_OFFICE_CALLER_NUMBER   — (optional) E.164 number outbound calls show
//                                   as caller ID, e.g. +16155889500
//
// Until those are set the function returns { ok:false, reason:'not_configured' }
// and the page shows a friendly "finish setup" message instead of breaking.
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TELNYX = 'https://api.telnyx.com/v2';

function json(code, body) {
  return { statusCode: code, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

async function verifyOffice(password) {
  if (!password) return false;
  try {
    const r = await fetch(`${XANO}/verify_office_password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }), signal: AbortSignal.timeout(8000),
    });
    const d = await r.json().catch(() => ({}));
    return !!(d && (d.valid || d.success || d.ok));
  } catch (_) { return false; }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, reason: 'method' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const okPw = await verifyOffice(body.password);
  if (!okPw) return json(401, { ok: false, reason: 'unauthorized' });

  const KEY = process.env.TELNYX_API_KEY;
  const CRED = process.env.TELNYX_WEBRTC_CREDENTIAL_ID;
  if (!KEY || !CRED) return json(200, { ok: false, reason: 'not_configured' });

  try {
    const r = await fetch(`${TELNYX}/telephony_credentials/${CRED}/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}` },
      signal: AbortSignal.timeout(9000),
    });
    // Telnyx returns the JWT as text/plain (the body IS the token). Be defensive
    // in case a future API version wraps it in JSON.
    const raw = await r.text();
    if (!r.ok) return json(200, { ok: false, reason: 'telnyx_error', status: r.status, detail: raw.slice(0, 300) });
    let token = (raw || '').trim();
    if (token.startsWith('{')) {
      try { const j = JSON.parse(token); token = (j && (j.token || (j.data && j.data.token))) || token; } catch (_) {}
    }
    if (!token) return json(200, { ok: false, reason: 'empty_token' });
    return json(200, {
      ok: true,
      token,
      caller_number: process.env.TELNYX_OFFICE_CALLER_NUMBER || '',
    });
  } catch (e) {
    return json(200, { ok: false, reason: 'mint_failed', detail: String((e && e.message) || e) });
  }
};
