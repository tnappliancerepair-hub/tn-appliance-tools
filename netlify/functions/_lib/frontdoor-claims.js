// frontdoor-claims — AHS / Frontdoor claim SUBMISSION transport (the money loop).
// Mirrors _lib/servicepower-claims.js submitClaims(): assemble → POST → parse. The
// estimate+invoice fields are already assembled by frontdoor-queue.js; the ONLY missing
// piece is Frontdoor's submission endpoint + payload shape — the open question for Akshay's
// team. Until FRONTDOOR_CLAIMS_PATH is set (and the wrapper/auth confirmed) this returns
// {configured:false} and submits NOTHING. Reuses _lib/frontdoor.js's authed api() (the same
// FusionAuth JWT as the live status push), so when the path lands it's a one-env-var flip.
'use strict';
const fd = require('./frontdoor');
const { getSecret } = require('./secrets');

// Submission path (relative to the FD apiBase). Unknown until Akshay confirms — no default,
// so nothing can accidentally POST to a guessed endpoint.
async function claimsPath() { return String((await getSecret('FRONTDOOR_CLAIMS_PATH')) || '').trim(); }

// Configured only when BOTH the API creds are vaulted AND we know the submission path.
async function isConfigured() {
  const [creds, path] = await Promise.all([fd.isConfigured(), claimsPath()]);
  return !!(creds && path);
}

// Submit one or more assembled AHS claim objects. Same JWT auth as the status push.
// REAL WRITE — only from the gated submit handler (confirm + FRONTDOOR_CLAIMS_LIVE=1).
async function submitClaims(claims) {
  const path = await claimsPath();
  if (!path) return { ok: false, configured: false, reason: 'awaiting Frontdoor submission API — set FRONTDOOR_CLAIMS_PATH (and confirm the payload wrapper + auth with Akshay) before going live' };
  if (!(await fd.isConfigured())) return { ok: false, configured: false, reason: 'Frontdoor API creds not in vault' };
  const arr = Array.isArray(claims) ? claims : [claims];
  // The real payload wrapper is the Akshay question. Best-guess mirror of the status-push
  // shape ({data:[{type,object}]}); FRONTDOOR_CLAIMS_WRAP=flat sends {claims:[...]} instead.
  const wrap = String((await getSecret('FRONTDOOR_CLAIMS_WRAP')) || 'data').toLowerCase();
  const body = wrap === 'flat' ? { claims: arr } : { data: arr.map((c) => ({ type: 'claim', object: c })) };
  const res = await fd.api('POST', path, body);
  return { ok: res.ok, configured: true, http_status: res.status, data: res.data, raw: String(res.raw || '').slice(0, 3000), sent: body };
}

module.exports = { isConfigured, submitClaims, claimsPath };
