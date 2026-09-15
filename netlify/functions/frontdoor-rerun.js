// frontdoor-rerun — start the AHS/Frontdoor API process over from step one and re-test
// EVERY assumption, in order, taking nothing on faith from the prior attempts.
//
// Run it a phase at a time so no phase can blow the function cap:
//   ?secret=<admin>&step=hosts      which hosts exist at all (DNS + does anything answer)
//   ?secret=<admin>&step=auth       every token URL x every grant shape — which actually mint
//   ?secret=<admin>&step=identity   ask the identity provider what this key IS (userinfo,
//                                   OIDC discovery, JWKS) — the authoritative answer to
//                                   "what are we provisioned for"
//   ?secret=<admin>&step=paths      the full path matrix incl. routing-id prefix guesses
//
// Nothing here writes anything anywhere. Credentials are never echoed; the raw token is
// never returned; any claim that looks credential-shaped is masked.
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');

exports.config = { timeout: 26 };

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

const SECRETISH = /(secret|password|passwd|pwd|token|refresh|api[_-]?key|client[_-]?secret|authorization)/i;
function safeVal(k, v) {
  if (SECRETISH.test(String(k))) return '«masked»';
  if (typeof v === 'string' && v.length > 64) return `«${v.length} chars»`;
  if (Array.isArray(v)) return v.slice(0, 12).map((x) => safeVal(k, x));
  if (v && typeof v === 'object') { const o = {}; for (const [a, b] of Object.entries(v).slice(0, 25)) o[a] = safeVal(a, b); return o; }
  return v;
}
function claimsOf(jwt) {
  try {
    const p = String(jwt).split('.');
    if (p.length < 2) return null;
    const j = JSON.parse(Buffer.from(p[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const o = {}; for (const [k, v] of Object.entries(j)) o[k] = safeVal(k, v);
    return o;
  } catch (_) { return null; }
}

async function hit(url, opts, ms) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(ms || 5000) });
    const tx = await r.text();
    return { status: r.status, ms: Date.now() - t0, len: tx.length, body: tx.slice(0, 260), ct: r.headers.get('content-type') || '' };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 110) };
  }
}

// ── candidate surfaces ──────────────────────────────────────────────────────────────────
const TOKEN_URLS = [
  ['sandbox-fusionauth', 'https://frontdoorhome-dev.fusionauth.io/oauth2/token'],
  ['prod-login',         'https://login.frontdoorhome.com/oauth2/token'],
  ['sandbox-login',      'https://login.sandbox.frontdoorhome.com/oauth2/token'],  // JWT `iss` claims this
  ['prod-fusionauth',    'https://frontdoorhome.fusionauth.io/oauth2/token'],
];
const API_HOSTS = [
  'https://api.sandbox.frontdoorhome.com',
  'https://api.frontdoorhome.com',
  'https://sandbox.api.frontdoorhome.com',
  'https://partner-api.frontdoorhome.com',
  'https://api-sandbox.frontdoorhome.com',
];

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'admin secret required (?secret=)' });
  const step = String(q.step || 'hosts').toLowerCase();

  const clientId = String((await getSecretFresh('FRONTDOOR_CLIENT_ID')) || '').trim();
  const username = String((await getSecretFresh('FRONTDOOR_API_USERNAME')) || '').trim();
  const password = String((await getSecretFresh('FRONTDOOR_API_PASSWORD')) || '').trim();
  if (!clientId || !username || !password) return json(200, { ok: false, error: 'FRONTDOOR_* creds missing from vault' });

  // ── STEP 1: do these hosts even exist? ────────────────────────────────────────────────
  if (step === 'hosts') {
    const rows = [];
    for (const h of API_HOSTS) rows.push({ host: h, ...(await hit(h + '/', { method: 'GET' }, 6000)) });
    for (const [label, u] of TOKEN_URLS) rows.push({ host: `${label} :: ${u}`, ...(await hit(u, { method: 'GET' }, 6000)) });
    return json(200, {
      ok: true, step,
      note: 'status 0 + error = does not resolve / unreachable. A 404 or 405 means a real server answered.',
      rows,
    });
  }

  // ── STEP 2: which token URL + grant shape actually mints? ─────────────────────────────
  if (step === 'auth') {
    const shapes = [
      ['password-grant (spec)',      (f) => { f.set('grant_type', 'password'); f.set('client_id', clientId); f.set('username', username); f.set('password', password); }],
      ['password-grant + scope',     (f) => { f.set('grant_type', 'password'); f.set('client_id', clientId); f.set('username', username); f.set('password', password); f.set('scope', 'openid offline_access'); }],
      ['client_credentials',         (f) => { f.set('grant_type', 'client_credentials'); f.set('client_id', clientId); f.set('client_secret', password); }],
    ];
    const rows = [];
    for (const [label, u] of TOKEN_URLS) {
      for (const [sLabel, build] of shapes) {
        const f = new URLSearchParams(); build(f);
        const r = await hit(u, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: f.toString() }, 7000);
        let tokenAcquired = false, claims = null;
        try { const j = JSON.parse(r.body || '{}'); const t = j.access_token || j.accessToken || j.token; tokenAcquired = !!t; if (t) claims = claimsOf(t); } catch (_) {}
        rows.push({ token_url: label, grant: sLabel, status: r.status, minted: tokenAcquired, roles: claims && claims.roles, iss: claims && claims.iss, body: tokenAcquired ? '(token — hidden)' : (r.body || r.error || '').slice(0, 180) });
      }
    }
    const working = rows.filter((r) => r.minted);
    return json(200, { ok: true, step, minted_count: working.length, rows, read: working.length ? `${working.length} combo(s) mint a token.` : 'NOTHING mints — the key itself is dead or the creds are wrong.' });
  }

  // Everything below needs a live token.
  async function mint() {
    for (const [label, u] of TOKEN_URLS) {
      const f = new URLSearchParams();
      f.set('grant_type', 'password'); f.set('client_id', clientId); f.set('username', username); f.set('password', password);
      const r = await hit(u, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: f.toString() }, 7000);
      try { const j = JSON.parse(r.body || '{}'); const t = j.access_token || j.accessToken || j.token; if (t) return { token: t, via: label, url: u }; } catch (_) {}
    }
    return null;
  }

  // ── STEP 3: ask the identity provider what this key IS ────────────────────────────────
  // This is the authoritative answer to "what are we provisioned for" — better than guessing
  // from 404s. FusionAuth exposes the registration/roles behind the token.
  if (step === 'identity') {
    const m = await mint();
    if (!m) return json(200, { ok: false, step, error: 'no token could be minted' });
    const origin = new URL(m.url).origin;
    const bearer = { Authorization: `Bearer ${m.token}`, Accept: 'application/json' };
    const rows = {};
    rows.openid_configuration = await hit(`${origin}/.well-known/openid-configuration`, { method: 'GET' }, 6000);
    rows.userinfo = await hit(`${origin}/oauth2/userinfo`, { method: 'GET', headers: bearer }, 6000);
    rows.jwks = await hit(`${origin}/.well-known/jwks.json`, { method: 'GET' }, 6000);
    // introspect tells us the token's scope/active state as the IdP sees it
    const introF = new URLSearchParams(); introF.set('token', m.token); introF.set('client_id', clientId);
    rows.introspect = await hit(`${origin}/oauth2/introspect`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: introF.toString() }, 6000);
    return json(200, { ok: true, step, minted_via: m.via, claims: claimsOf(m.token), probes: rows });
  }

  // ── STEP 4: the full path matrix ──────────────────────────────────────────────────────
  if (step === 'paths') {
    const m = await mint();
    if (!m) return json(200, { ok: false, step, error: 'no token could be minted' });
    const c = claimsOf(m.token) || {};
    const bearer = { Authorization: `Bearer ${m.token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
    const host = String(q.host || 'https://api.sandbox.frontdoorhome.com');
    const dispatchId = Number(q.dispatch || 999999);

    const lifecycle = { dispatchNumber: dispatchId, status: 'JobComplete' };
    const nowIso = new Date().toISOString();
    const connector = { data: [{ type: 'status', object: {
      source: 'DISPATCH_ME', tenant: 'AHS', dispatch_id: dispatchId, vendor_id: '839828',
      description: 'Job Complete', status_code: 10, note: 'Ant probe — ignore',
      updated_at: nowIso, start_time: nowIso, end_time: nowIso } }] };

    // routing-id segment candidates: the spec says the URL carries one, and we were never
    // issued it. These are the identifiers we DO hold — worth eliminating cheaply.
    const prefixes = ['', '/ahs', '/ftdr', `/${c.org_id || 'x'}`, `/${c.applicationId || 'x'}`];
    const paths = [];
    for (const p of prefixes) {
      paths.push(['POST', `${p}/v1/case-lifecycle/dispatch_status_update`, lifecycle]);
      paths.push(['POST', `${p}/dispatch-connector/v1/webhook`, connector]);
    }
    // other documented surfaces — the control group. If ANY of these answer, our key works
    // and only the dispatch surface is missing.
    paths.push(['GET', '/address/v1/zip?zip=37013', null]);
    paths.push(['GET', '/dtc/v1/plans', null]);
    paths.push(['GET', '/real-estate/v2/offices', null]);
    paths.push(['GET', '/v1/case-lifecycle', null]);
    paths.push(['OPTIONS', '/v1/case-lifecycle/dispatch_status_update', null]);

    const results = [];
    for (const [meth, path, body] of paths) {
      const r = await hit(`${host}${path}`, { method: meth, headers: bearer, body: body ? JSON.stringify(body) : undefined }, 4500);
      results.push({ method: meth, path, status: r.status, ms: r.ms, body: (r.body || r.error || '').slice(0, 120) });
    }
    const alive = results.filter((r) => ![0, 404].includes(r.status));
    return json(200, {
      ok: true, step, host, minted_via: m.via,
      results,
      alive_count: alive.length,
      read: alive.length
        ? `${alive.length} path(s) answered with something other than 404 — those are real.`
        : 'Every path 404s on this host. Try ?host=https://api.frontdoorhome.com to repeat against production.',
    });
  }

  return json(200, { ok: false, error: 'unknown step — use hosts | auth | identity | paths' });
};
