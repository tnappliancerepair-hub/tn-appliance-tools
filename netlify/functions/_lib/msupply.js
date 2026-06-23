// msupply.js — connector for the mSupply parts API (real OEM cost + live stock +
// drop-ship ordering), replacing the browser-scraping daemon for this supplier.
//
// Auth: OAuth 2.0 Client Credentials (per mSupply's "Generate Access Token" doc).
// POST {tokenUrl} grant_type=client_credentials with client_id + client_secret ->
// Bearer token. Token cached per warm container.
//
// Config (all vault-first via getSecret, so nothing hits Netlify's 4KB env cap):
//   MSUPPLY_BASE_URL      - default 'https://int-api.msupply.com' (Integration).
//                           Flip to 'https://api.msupply.com' (Production) when verified.
//   MSUPPLY_CLIENT_ID     - client_id from the one-time secret
//   MSUPPLY_CLIENT_SECRET - client_secret from the one-time secret
//   MSUPPLY_SCOPE         - (optional) OAuth scope if their token endpoint requires one
//   MSUPPLY_TOKEN_URL     - (optional) override; defaults to {base}/AccessToken
//   MSUPPLY_CUST_NO       - (optional) default customer/account number for lookups
//
// Docs: https://api.msupply.com/swagger/index.html
'use strict';

// Use getSecretFresh for config so vault edits (env switch, credential swap) take
// effect immediately instead of being pinned by a warm container's cache.
const { getSecret, getSecretFresh } = require('./secrets');

let _tok = null, _tokExp = 0;

async function baseUrl() {
  const b = (await getSecretFresh('MSUPPLY_BASE_URL')) || 'https://int-api.msupply.com';
  return b.replace(/\/+$/, '');
}

async function getToken(force) {
  if (!force && _tok && Date.now() < _tokExp - 30000) return _tok;
  const base = await baseUrl();
  const tokenUrl = (await getSecretFresh('MSUPPLY_TOKEN_URL')) || `${base}/AccessToken`;
  const clientId = await getSecretFresh('MSUPPLY_CLIENT_ID');
  const clientSecret = await getSecretFresh('MSUPPLY_CLIENT_SECRET');
  const scope = await getSecretFresh('MSUPPLY_SCOPE');
  if (!clientId || !clientSecret) throw new Error('mSupply client_id/secret not in vault (MSUPPLY_CLIENT_ID / MSUPPLY_CLIENT_SECRET)');

  const form = new URLSearchParams();
  form.set('grant_type', 'client_credentials');
  if (scope) form.set('scope', scope);

  // Standard OAuth2: try client auth as a Basic header first (Postman's default),
  // then fall back to sending client_id/secret in the body.
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  let r = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}`, Accept: 'application/json' },
    body: form.toString(), signal: AbortSignal.timeout(12000),
  });
  if (!r.ok && (r.status === 400 || r.status === 401)) {
    const form2 = new URLSearchParams(form);
    form2.set('client_id', clientId); form2.set('client_secret', clientSecret);
    r = await fetch(tokenUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form2.toString(), signal: AbortSignal.timeout(12000),
    });
  }
  const text = await r.text();
  let j = {}; try { j = JSON.parse(text); } catch (_) {}
  if (!r.ok) throw new Error(`AccessToken ${r.status}: ${text.slice(0, 220)}`);
  const token = j.access_token || j.accessToken || j.token || j.Token;
  if (!token) throw new Error(`AccessToken: no access_token in response: ${text.slice(0, 200)}`);
  _tok = token;
  const ttl = (j.expires_in || j.expiresIn || 1800) * 1000;
  _tokExp = Date.now() + ttl;
  return token;
}

async function api(method, path, bodyObj) {
  const base = await baseUrl();
  const token = await getToken();
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  // One retry on 401 (token expired mid-flight).
  if (r.status === 401) {
    const t2 = await getToken(true);
    const r2 = await fetch(`${base}${path}`, {
      method, headers: { Authorization: `Bearer ${t2}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: bodyObj ? JSON.stringify(bodyObj) : undefined, signal: AbortSignal.timeout(15000),
    });
    const tx2 = await r2.text(); let j2 = {}; try { j2 = JSON.parse(tx2); } catch (_) {}
    return { ok: r2.ok, status: r2.status, data: j2, raw: tx2 };
  }
  const tx = await r.text(); let j = {}; try { j = JSON.parse(tx); } catch (_) {}
  return { ok: r.ok, status: r.status, data: j, raw: tx };
}

// Look up a part's price + availability by make + part number.
// Returns a normalized shape the parts UI can consume directly.
async function lookupPart(partNumber, make, opts) {
  opts = opts || {};
  const custNo = opts.custNo || (await getSecret('MSUPPLY_CUST_NO')) || undefined;
  const reqBody = {
    partNumber: String(partNumber || '').trim(),
    make: make ? String(make).trim() : undefined,
    lookupType: opts.lookupType || 'Default',
    custNo,
    branchNumber: opts.branchNumber || undefined,
    tntShipToZip: opts.zip || undefined,
  };
  const resp = await api('POST', '/parts/lookup', reqBody);
  if (!resp.ok) return { ok: false, status: resp.status, error: (resp.data && (resp.data.message || resp.data.error)) || resp.raw.slice(0, 200) };
  return { ok: true, ...normalizePart(resp.data) };
}

// Normalize the lookup response (the API may return a single part or a list).
function normalizePart(d) {
  const part = Array.isArray(d) ? d[0] : (d && d.parts ? d.parts[0] : (d && d.part ? d.part : d)) || {};
  const inv = part.inventory || part.availability || [];
  const stock = (Array.isArray(inv) ? inv : []).map((w) => ({
    warehouse: w.warehouseName || w.warehouseNumber,
    qty: w.quantityAvailable != null ? w.quantityAvailable : w.qty,
    transit_days: w.timeInTransitDays != null ? w.timeInTransitDays : w.transitDays,
  }));
  const totalQty = stock.reduce((s, w) => s + (Number(w.qty) || 0), 0);
  const soonest = stock.filter((w) => Number(w.qty) > 0).map((w) => Number(w.transit_days) || 0).sort((a, b) => a - b)[0];
  return {
    make: part.make, part_number: part.partNumber, description: part.description,
    cost: part.dealer != null ? part.dealer : part.price,   // our cost
    price: part.price, retail: part.retail, list: part.list, core_cost: part.coreCost,
    in_stock: totalQty > 0, total_qty: totalQty, eta_days: soonest != null ? soonest : null,
    discontinued: !!part.isDiscontinued, drop_ship_only: !!part.isDropShipOnly, hazmat: !!part.isHazMat,
    stock, raw: part,
  };
}

module.exports = { getToken, lookupPart, normalizePart, api, baseUrl };
