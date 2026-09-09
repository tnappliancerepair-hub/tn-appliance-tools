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
// Required config for CREDENTIAL mode. These live in the runtime VAULT
// (admin-secrets.html), not Netlify env — Netlify is at the 4KB Lambda cap:
//   TELNYX_SIP_USERNAME[_DANIELLE|_SOFIA]  — one credential per seat, never shared
//   TELNYX_SIP_PASSWORD[_DANIELLE|_SOFIA]  — that credential's SIP password (secret)
//   TELNYX_OFFICE_CALLER_NUMBER            — E.164 caller ID on outbound (e.g. +16152802949)
//
// Two failure reasons, and the difference matters to the human staring at the page:
//   'not_configured' — genuinely unset. Somebody has setup work to do.
//   'vault_busy'     — the vault read timed out (Xano slow). Nothing is wrong with
//                      the setup; flipping On again in a few seconds works.
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TELNYX = 'https://api.telnyx.com/v2';
const { getSecret, getSecretStatus, getSecretPreferVault } = require('./_lib/secrets');

function json(code, body) {
  return { statusCode: code, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

// Verify the office password the SAME way the office-verify gate does: vault-first
// (OFFICE_PASSWORD), and only fall back to the legacy Xano check while the vault is
// EMPTY. The gate moved to the vault 2026-07-30 (Teddy couldn't get into Xano), but
// this endpoint still checked Xano directly — so the current password passed the
// gate yet failed here → "Line server said: unauthorized." on flip-On.
async function verifyOffice(password) {
  const pw = String(password || '').trim();
  if (!pw) return false;
  try {
    const vaultPw = String((await getSecretPreferVault('OFFICE_PASSWORD')) || '').trim();
    if (vaultPw) return pw === vaultPw;   // vault is authoritative once set
  } catch (_) {}
  try {
    const r = await fetch(`${XANO}/verify_office_password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }), signal: AbortSignal.timeout(8000),
    });
    const d = await r.json().catch(() => ({}));
    return !!(d && (d.valid || d.success || d.ok));
  } catch (_) { return false; }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, reason: 'method' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  // The office phone is passwordless (Teddy 2026-08-03) — the page arms the line
  // with a fixed app token instead of a typed password. Accept that token, OR the
  // office password (back-compat / any other caller). Keeps the raw endpoint from
  // being fully anonymous while asking the user for nothing.
  const APP_TOKEN = 'tnp-office-phone-open-9x4k2m7q';
  const okPw = String(body.password || '') === APP_TOKEN || await verifyOffice(body.password);
  if (!okPw) return json(401, { ok: false, reason: 'unauthorized' });

  // Which SIP credential this seat uses. Per-person logins so Teddy + Danielle +
  // Sofia don't share one credential (sharing one caused the WebSocket thrash that
  // dropped calls). Falls back to the default credential if a person-specific one
  // isn't provisioned yet (nothing breaks pre-provision).
  const who = String(body.who || '').toLowerCase();
  const suffix = who === 'danielle' ? '_DANIELLE' : (who === 'sofia' ? '_SOFIA' : '');

  // 2026-09-09 — Sofia hit "One-time setup still needed" at 11:20am on a line that
  // WAS fully configured. Cause: these creds live in the Xano-backed vault, and
  // getSecret() swallows a slow/timed-out vault read as ''. Six SEQUENTIAL reads at a
  // 4s cap each, on a cold container against a chronically saturated Xano, and one
  // hiccup cascaded into a bogus "not configured". Three fixes, in order of value:
  //   1. read in PARALLEL (worst case ~4s instead of ~24s),
  //   2. retry the whole read ONCE (the second pass runs with a warm table-id cache),
  //   3. tell the truth — a vault timeout reports 'vault_busy', not 'not_configured'.
  async function readCreds() {
    const [c, u, p] = await Promise.all([
      getSecretStatus('TELNYX_OFFICE_CALLER_NUMBER'),
      getSecretStatus('TELNYX_SIP_USERNAME' + suffix),
      getSecretStatus('TELNYX_SIP_PASSWORD' + suffix),
    ]);
    let user = u.value, pass = p.value;
    let transient = !u.ok || !p.ok || !c.ok;
    if ((!user || !pass) && suffix) {
      const [du, dp] = await Promise.all([
        getSecretStatus('TELNYX_SIP_USERNAME'),
        getSecretStatus('TELNYX_SIP_PASSWORD'),
      ]);
      user = du.value; pass = dp.value;
      transient = transient || !du.ok || !dp.ok;
    }
    return { caller: c.value || '', user, pass, transient };
  }

  let creds = await readCreds();
  if ((!creds.user || !creds.pass) && creds.transient) {
    await new Promise((r) => setTimeout(r, 400));
    creds = await readCreds();                       // one retry, warm cache
  }

  if (creds.user && creds.pass) {
    return json(200, { ok: true, mode: 'credential', login: creds.user, password: creds.pass, caller_number: creds.caller });
  }

  // --- TOKEN mode (optional upgrade) ---
  const [keyS, credS] = await Promise.all([
    getSecretStatus('TELNYX_API_KEY'),
    getSecretStatus('TELNYX_WEBRTC_CREDENTIAL_ID'),
  ]);
  const KEY = keyS.value, CRED = credS.value;
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
      return json(200, { ok: true, mode: 'token', token, caller_number: creds.caller });
    } catch (e) {
      return json(200, { ok: false, reason: 'mint_failed', detail: String((e && e.message) || e) });
    }
  }

  // Nothing resolved. Say WHY: a busy vault is a "try again", not a setup task.
  if (creds.transient || !keyS.ok || !credS.ok) {
    return json(200, { ok: false, reason: 'vault_busy' });
  }
  return json(200, { ok: false, reason: 'not_configured' });
};
