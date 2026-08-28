// vendor-verify — real, credential-in auth probes for a tenant's OWN vendor accounts. Given a
// vendor + the decrypted creds a shop connected, this actually authenticates against the vendor
// (mint a token / a cred-bearing SOAP call) and reports connected / error. It reuses each
// connector's transport but injects the TENANT's creds, so it never touches TN's vault path.
// This is what turns "creds stored" into "creds verified", for every vendor at once.
'use strict';
const sp = require('./servicepower');
function xesc(s) { return String(s == null ? '' : s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])); }

// ---- Marcone / mSupply: OAuth2 client_credentials (Basic header, then body fallback) ----
async function verifyMarcone(c) {
  const base = (c.base || 'https://api.msupply.com').replace(/\/+$/, '');
  const tokenUrl = c.token_url || `${base}/AccessToken`;
  const id = String(c.client_id || '').trim(), secret = String(c.client_secret || '').trim();
  if (!id || !secret) return { ok: false, detail: 'missing client id/secret' };
  const form = new URLSearchParams({ grant_type: 'client_credentials' });
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  let r = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}`, Accept: 'application/json' }, body: form.toString(), signal: AbortSignal.timeout(11000) });
  if (!r.ok && (r.status === 400 || r.status === 401)) {
    const f2 = new URLSearchParams(form); f2.set('client_id', id); f2.set('client_secret', secret);
    r = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: f2.toString(), signal: AbortSignal.timeout(11000) });
  }
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (_) {}
  if (r.ok && (j.access_token || j.token)) return { ok: true, detail: 'token minted' };
  return { ok: false, detail: `auth ${r.status}` };
}

// ---- Frontdoor / AHS: OAuth2 password grant ----
async function verifyAhs(c) {
  const sandbox = String(c.env || '').toLowerCase() === 'sandbox';
  const tokenUrl = sandbox ? 'https://frontdoorhome-dev.fusionauth.io/oauth2/token' : 'https://login.frontdoorhome.com/oauth2/token';
  const id = String(c.client_id || '').trim(), user = String(c.api_username || '').trim(), pass = String(c.api_password || '').trim();
  if (!id || !user || !pass) return { ok: false, detail: 'missing client id / username / password' };
  const form = new URLSearchParams({ grant_type: 'password', client_id: id, username: user, password: pass });
  const r = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form.toString(), signal: AbortSignal.timeout(11000) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (_) {}
  if (r.ok && (j.access_token || j.token)) return { ok: true, detail: 'token minted' };
  return { ok: false, detail: `auth ${r.status}` };
}

// ---- ServicePower: a cred-bearing SOAP getCallInfo over a 1-day window. Reuses the connector's
// transport (sp.soapCall) but bakes the TENANT's UserInfo into the envelope. Valid creds -> ok
// (even with 0 calls); bad login -> a fault / auth error. ----
async function verifyServicePower(c) {
  const u = String(c.user_id || '').trim(), p = String(c.password || '').trim(), a = String(c.servicer_acct || '').trim();
  if (!u || !p || !a) return { ok: false, detail: 'missing user id / password / servicer account' };
  const ui = `<UserInfo><UserID>${xesc(u)}</UserID><Password>${xesc(p)}</Password><SvcrAcct>${xesc(a)}</SvcrAcct></UserInfo>`;
  const now = new Date(), y = new Date(now.getTime() - 24 * 3600 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '') + '000000';
  const inner = `<impl:getCallInfoSearch>${ui}<FromDateTime>${fmt(y)}</FromDateTime><ToDateTime>${fmt(now)}</ToDateTime></impl:getCallInfoSearch>`;
  try {
    const r = await sp.soapCall(inner, '');
    const raw = String(r.raw || ''), code = String(r.err_code || '').toUpperCase();
    // bad login = SP004 "Invalid Authentication Credentials" (inside <ErrorInfo><Code>),
    // a SOAP fault, or an explicit invalid-auth message. Default is NOT-authenticated.
    if (r.fault || code === 'SP004' || /invalid authentication/i.test(raw)) {
      return { ok: false, detail: 'login rejected (invalid credentials)' };
    }
    // a processed 200 SOAP response with no auth error = the creds were accepted
    if (r.status === 200) return { ok: true, detail: 'authenticated' };
    return { ok: false, detail: 'servicepower ' + (code || ('http ' + r.status)) };
  } catch (e) { return { ok: false, detail: String((e && e.message) || e).slice(0, 70) }; }
}

// Vendor -> its verifier. NSA has no API (portal only) -> stored, used at dispatch time.
async function verify(vendor, creds) {
  try {
    if (vendor === 'marcone') return await verifyMarcone(creds);
    if (vendor === 'ahs') return await verifyAhs(creds);
    if (vendor === 'servicepower') return await verifyServicePower(creds);
    if (vendor === 'nsa') return { ok: null, detail: 'saved — NSA is portal-only (no API to test); used at dispatch time' };
  } catch (e) { return { ok: false, detail: String((e && e.message) || e).slice(0, 70) }; }
  return { ok: null, detail: 'stored — no verifier for this vendor' };
}

module.exports = { verify };
