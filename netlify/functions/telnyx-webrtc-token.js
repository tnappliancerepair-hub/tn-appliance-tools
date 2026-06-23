// telnyx-webrtc-token — hands the Ant Office Phone (office-phone.html) the
// credentials it needs to log into the Telnyx "Ant office phone" Credential
// Connection. The browser SDK (@telnyx/webrtc) registers as that extension, so
// the office phone can place calls AND receive Ant's live-transfers.
//
// The page POSTs { password }; we verify it against Xano's verify_office_password
// (so only Teddy/Danielle can arm a line), then return the login material.
//
// Two supported modes (we use CREDENTIAL):
//   CREDENTIAL (default) — return the SIP username + password from env. The SDK
//                          logs in with { login, password }. Simplest; what the
//                          portal walkthrough set up.
//   TOKEN — if TELNYX_API_KEY + TELNYX_WEBRTC_CREDENTIAL_ID are set instead, mint
//           a short-lived JWT (login_token). More secure; optional upgrade later.
//
// Required Netlify env for CREDENTIAL mode:
//   TELNYX_SIP_USERNAME           — e.g. userteddy74923
//   TELNYX_SIP_PASSWORD           — the connection's SIP password (secret)
//   TELNYX_OFFICE_CALLER_NUMBER   — E.164 number outbound calls show as caller ID
//                                   (e.g. +16155889500)
//
// Until those are set the function returns { ok:false, reason:'not_configured' }
// and the page shows a friendly "finish setup" message instead of breaking.
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TELNYX = 'https://api.telnyx.com/v2';
const { getSecret } = require('./_lib/secrets');

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

  // Read from env-first, then the runtime vault (app_config) — Netlify's 4KB
  // env cap is full, so these live in the vault via admin-secrets.html.
  const caller = (await getSecret('TELNYX_OFFICE_CALLER_NUMBER')) || '';

  // --- CREDENTIAL mode (default) ---
  // Per-person logins so Teddy + Danielle don't share one credential (sharing one
  // caused the WebSocket thrash that dropped calls). who=danielle gets the _DANIELLE
  // credential; anyone else gets the default. Falls back to the default credential
  // if a person-specific one isn't provisioned yet (nothing breaks pre-provision).
  const who = String(body.who || '').toLowerCase();
  const suffix = who === 'danielle' ? '_DANIELLE' : '';
  let user = await getSecret('TELNYX_SIP_USERNAME' + suffix);
  let pass = await getSecret('TELNYX_SIP_PASSWORD' + suffix);
  if (!user || !pass) { user = await getSecret('TELNYX_SIP_USERNAME'); pass = await getSecret('TELNYX_SIP_PASSWORD'); }
  if (user && pass) {
    return json(200, { ok: true, mode: 'credential', login: user, password: pass, caller_number: caller });
  }

  // --- TOKEN mode (optional upgrade) ---
  const KEY = await getSecret('TELNYX_API_KEY');
  const CRED = await getSecret('TELNYX_WEBRTC_CREDENTIAL_ID');
  if (KEY && CRED) {
    try {
      const r = await fetch(`${TELNYX}/telephony_credentials/${CRED}/token`, {
        method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(9000),
      });
      const raw = await r.text();
      if (!r.ok) return json(200, { ok: false, reason: 'telnyx_error', status: r.status, detail: raw.slice(0, 300) });
      let token = (raw || '').trim();
      if (token.startsWith('{')) {
        try { const j = JSON.parse(token); token = (j && (j.token || (j.data && j.data.token))) || token; } catch (_) {}
      }
      if (!token) return json(200, { ok: false, reason: 'empty_token' });
      return json(200, { ok: true, mode: 'token', token, caller_number: caller });
    } catch (e) {
      return json(200, { ok: false, reason: 'mint_failed', detail: String((e && e.message) || e) });
    }
  }

  return json(200, { ok: false, reason: 'not_configured' });
};
