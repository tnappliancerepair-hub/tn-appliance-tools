// reliable — connector for Reliable Parts, our SECOND OEM parts source (catches
// Samsung / superseded numbers Marcone (mSupply) misses). Mirrors the proven
// mSupply pattern: vault-first config, cached auth, lookup + order.
//
// ⚠️ SPEC PENDING: Alex Quintans (BD Manager, Reliable Parts) sent the API spec +
// access by email (attachment). Until the exact base URL / auth / endpoint paths
// are confirmed from that spec, the request PATHS and AUTH_MODE below are driven
// entirely from the vault so they can be set with NO code change:
//   - fill RELIABLE_LOOKUP_PATH / RELIABLE_ORDER_PATH / RELIABLE_TOKEN_URL, and
//   - set RELIABLE_AUTH_MODE to 'oauth' | 'apikey' | 'basic'
// then reliable-test.js will confirm auth and a real lookup.
//
// Config (all vault-first via getSecretFresh, so nothing hits Netlify's 4KB cap):
//   RELIABLE_BASE_URL     - API base, e.g. 'https://api.reliableparts.com'
//   RELIABLE_AUTH_MODE    - 'oauth' (default) | 'apikey' | 'basic'
//   RELIABLE_CLIENT_ID    - OAuth client_id            (oauth mode)
//   RELIABLE_CLIENT_SECRET- OAuth client_secret        (oauth mode)
//   RELIABLE_TOKEN_URL    - OAuth token endpoint        (default `${base}/oauth/token`)
//   RELIABLE_SCOPE        - OAuth scope (optional)
//   RELIABLE_API_KEY      - API key                     (apikey mode)
//   RELIABLE_API_KEY_HEADER - header name for the key   (default 'Authorization', value 'Bearer <key>')
//   RELIABLE_USER / RELIABLE_PASS - basic-auth creds    (basic mode)
//   RELIABLE_ACCOUNT      - our account/customer number (optional, sent on lookups/orders)
//   RELIABLE_LOOKUP_PATH  - part-lookup path            (default '/parts/search')
//   RELIABLE_ORDER_PATH   - place-order path            (default '/orders')
'use strict';
const { getSecret, getSecretFresh } = require('./secrets');

let _tok = null; let _tokExp = 0;

async function baseUrl() {
  const b = (await getSecretFresh('RELIABLE_BASE_URL')) || 'https://api.reliableparts.com';
  return String(b).replace(/\/+$/, '');
}
async function authMode() {
  return String((await getSecretFresh('RELIABLE_AUTH_MODE')) || 'oauth').trim().toLowerCase();
}

// True only when enough config exists to actually call the API.
async function isConfigured() {
  const mode = await authMode();
  if (mode === 'apikey') return !!(await getSecretFresh('RELIABLE_API_KEY'));
  if (mode === 'basic') return !!((await getSecretFresh('RELIABLE_USER')) && (await getSecretFresh('RELIABLE_PASS')));
  return !!((await getSecretFresh('RELIABLE_CLIENT_ID')) && (await getSecretFresh('RELIABLE_CLIENT_SECRET')));
}

async function getToken(force) {
  if (!force && _tok && Date.now() < _tokExp) return _tok;
  const base = await baseUrl();
  const tokenUrl = (await getSecretFresh('RELIABLE_TOKEN_URL')) || `${base}/oauth/token`;
  const clientId = String(await getSecretFresh('RELIABLE_CLIENT_ID') || '').trim();
  const clientSecret = String(await getSecretFresh('RELIABLE_CLIENT_SECRET') || '').trim();
  const scope = await getSecretFresh('RELIABLE_SCOPE');
  if (!clientId || !clientSecret) throw new Error('Reliable client_id/secret not in vault (RELIABLE_CLIENT_ID / RELIABLE_CLIENT_SECRET)');
  const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
  if (scope) form.set('scope', scope);
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  // Try Basic-auth header first (like mSupply), fall back to creds-in-body.
  let r = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}`, Accept: 'application/json' }, body: form.toString() });
  let text = await r.text();
  if (!r.ok) {
    r = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form.toString() });
    text = await r.text();
  }
  let j = {}; try { j = JSON.parse(text); } catch (_) {}
  if (!r.ok) throw new Error(`Reliable token ${r.status}: ${text.slice(0, 200)}`);
  const token = j.access_token || j.accessToken || j.token || j.Token;
  if (!token) throw new Error(`Reliable token: no access_token in response: ${text.slice(0, 200)}`);
  _tok = token; _tokExp = Date.now() + Math.max(60, (Number(j.expires_in) || 3000) - 60) * 1000;
  return token;
}

// Build auth headers per the configured mode.
async function authHeaders() {
  const mode = await authMode();
  if (mode === 'apikey') {
    const key = String(await getSecretFresh('RELIABLE_API_KEY') || '').trim();
    const hdr = (await getSecretFresh('RELIABLE_API_KEY_HEADER')) || 'Authorization';
    const val = /authorization/i.test(hdr) ? `Bearer ${key}` : key;
    return { [hdr]: val };
  }
  if (mode === 'basic') {
    const u = String(await getSecretFresh('RELIABLE_USER') || '').trim();
    const p = String(await getSecretFresh('RELIABLE_PASS') || '').trim();
    return { Authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` };
  }
  return { Authorization: `Bearer ${await getToken()}` };
}

async function api(method, path, bodyObj) {
  const base = await baseUrl();
  const auth = await authHeaders();
  const opts = { method, headers: { ...auth, 'Content-Type': 'application/json', Accept: 'application/json' } };
  if (bodyObj != null) opts.body = JSON.stringify(bodyObj);
  let r = await fetch(base + path, opts);
  // one retry on 401 for oauth (token expired mid-flight)
  if (r.status === 401 && (await authMode()) === 'oauth') {
    const t2 = await getToken(true);
    r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${t2}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: bodyObj != null ? JSON.stringify(bodyObj) : undefined });
  }
  const text = await r.text();
  let d = null; try { d = JSON.parse(text); } catch (_) { d = text; }
  return { ok: r.ok, status: r.status, data: d, raw: text };
}

// Normalize a Reliable part record to the shape the tech tool + repair-quote use
// (matches the mSupply/Marcone normalized shape). Field names are best-guess and
// finalized from the spec's response schema.
function normalizePart(p) {
  if (!p || typeof p !== 'object') return null;
  const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n; };
  return {
    source: 'reliable',
    part_number: p.partNumber || p.part_number || p.sku || p.number || '',
    description: p.description || p.name || p.title || '',
    brand: p.brand || p.manufacturer || p.make || '',
    cost: num(p.cost != null ? p.cost : (p.price != null ? p.price : p.netPrice)),
    list_price: num(p.listPrice != null ? p.listPrice : p.msrp),
    in_stock: (p.inStock != null ? !!p.inStock : (num(p.quantity) != null ? num(p.quantity) > 0 : null)),
    quantity: num(p.quantity != null ? p.quantity : p.qtyAvailable),
    eta: p.eta || p.estimatedDelivery || null,
    raw: p,
  };
}

// Look up a part by number (or model). Endpoint path from the vault (SPEC-pending).
async function lookupPart(query, opts) {
  opts = opts || {};
  const path = (await getSecretFresh('RELIABLE_LOOKUP_PATH')) || '/parts/search';
  const account = opts.account || (await getSecret('RELIABLE_ACCOUNT')) || undefined;
  const reqBody = { query: String(query || '').trim(), searchString: String(query || '').trim() };
  if (account) reqBody.accountNumber = account;
  const resp = await api('POST', path, reqBody);
  if (!resp.ok) return { ok: false, status: resp.status, error: resp.data };
  // response shape finalized from spec; try common containers
  const list = Array.isArray(resp.data) ? resp.data
    : (resp.data && (resp.data.results || resp.data.parts || resp.data.items || resp.data.partResults)) || [];
  return { ok: true, results: (list || []).map(normalizePart).filter(Boolean), raw: resp.data };
}

// Place a drop-ship order (ship to customer). Scaffold — finalized from spec.
async function placeOrder({ account, shipTo, items, poNumber, notes }) {
  const path = (await getSecretFresh('RELIABLE_ORDER_PATH')) || '/orders';
  const acct = account || (await getSecret('RELIABLE_ACCOUNT')) || undefined;
  return api('POST', path, { accountNumber: acct, shipTo, items, poNumber, notes });
}

module.exports = { baseUrl, authMode, isConfigured, getToken, authHeaders, api, lookupPart, placeOrder, normalizePart };
