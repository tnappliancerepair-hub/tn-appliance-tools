// office-verify — the office password gate, moved OFF the Xano env var and into
// the vault so it can be rotated without touching Xano (Teddy 2026-07-30: "move
// it to the vault, I'm having a hard time getting into Xano").
//
// Drop-in for the old Xano `verify_office_password` call: same POST {password},
// same {success} response, so every office page just points here.
//
//   POST { password }  ->  { success: bool }
//
// Password source = vault key OFFICE_PASSWORD (set/rotated via set-secret /
// admin-secrets.html). If the vault has NO value (misconfig/outage) it falls
// back to the legacy Xano check so the office is never locked out — once the
// vault holds a password, that fallback never runs and the old one stops working.
'use strict';

const { getSecretPreferVault, getSecretFresh } = require('./_lib/secrets');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
function json(c, b) { return { statusCode: c, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'method' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const pw = String(b.password || b.pw || '').trim();
  if (!pw) return json(200, { success: false });

  // Primary: the vault-managed office password.
  //
  // 🔴 READ IT FRESH. secrets.js caches a REAL value for the life of a warm container
  // (only the EMPTY case has a 20s TTL), so a cached getSecret means ROTATING THE OFFICE
  // PASSWORD SILENTLY DOES NOTHING -- set-secret returns {stored:true}, the vault holds
  // the new value, and every warm container keeps checking against the old one until it
  // happens to recycle. Measured 2026-09-15: the new password was refused for 90+ seconds
  // straight after a confirmed write, with the owner locked out of his own office.
  // A password gate is exactly the thing that must never answer from cache.
  let vaultPw = '';
  try { vaultPw = String((await getSecretFresh('OFFICE_PASSWORD')) || '').trim(); } catch (_) {}
  // Fall back to the cached/env read only if the fresh one came back empty (vault blip) --
  // never lock the office out over a transient read.
  if (!vaultPw) { try { vaultPw = String((await getSecretPreferVault('OFFICE_PASSWORD')) || '').trim(); } catch (_) {} }
  if (vaultPw && pw === vaultPw) return json(200, { success: true, valid: true, ok: true, via: 'vault' });

  // Safety net — only while the vault is empty (never lock the office out).
  if (!vaultPw) {
    try {
      const r = await fetch(`${XANO}/verify_office_password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }), signal: AbortSignal.timeout(8000),
      });
      const d = await r.json().catch(() => ({}));
      if (d && (d.success || d.valid || d.ok)) return json(200, { success: true, valid: true, ok: true, via: 'legacy' });
    } catch (_) {}
  }
  return json(200, { success: false });
};
