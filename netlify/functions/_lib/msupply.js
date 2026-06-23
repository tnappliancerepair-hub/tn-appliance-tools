// msupply.js — connector for the mSupply parts API (real OEM cost + live stock +
// drop-ship ordering), replacing the browser-scraping daemon for this supplier.
//
// Config (all vault-first via getSecret, so nothing hits Netlify's 4KB env cap):
//   MSUPPLY_BASE_URL   - default 'https://int-api.msupply.com' (Integration). Flip
//                        to 'https://api.msupply.com' (Production) when verified.
//   MSUPPLY_API_USER   - account name from the one-time secret
//   MSUPPLY_API_KEY    - account number from the one-time secret
//   MSUPPLY_CUST_NO    - (optional) default customer/account number for lookups
//   MSUPPLY_AUTH_JSON  - (optional) exact JSON body for /AccessToken if the field
//                        names differ from the AccountName/AccountNumber default
//                        (their Postman doc has the exact contract).
//
// Auth: POST {base}/AccessToken -> bearer token. Token cached per warm container.
// Docs: https://api.msupply.com/swagger/index.html
'use strict';

const { getSecret } = require('./secrets');

let _tok = null, _tokExp = 0;

async function baseUrl() {
  const b = (await getSecret('MSUPPLY_BASE_URL')) || 'https://int-api.msupply.com';
  return b.replace(/\/+$/, '');
}

// Build the /AccessToken request body. Their one-time secret is an "account name
// and number"; the documented default field names are AccountName/AccountNumber.
// If their Postman contract differs, set MSUPPLY_AUTH_JSON to the exact body.
async function authBody() {
  const override = await getSecret('MSUPPLY_AUTH_JSON');
  if (override) { try { return JSON.parse(override); } catch (_) {} }
  const user = await getSecret('MSUPPLY_API_USER');
  const key = await getSecret('MSUPPLY_API_KEY');
  return { AccountName: user, AccountNumber: key };
}

async function getToken(force) {
  if (!force && _tok && Date.now() < _tokExp - 30000) return _tok;
  const base = await baseUrl();
  const body = await authBody();
  if (!body || (!body.AccountName && !body.username && !body.clientId)) {
    throw new Error('mSupply credentials not in vault (MSUPPLY_API_USER / MSUPPLY_API_KEY)');
  }
  const r = await fetch(`${base}/AccessToken`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
  });
  const text = await r.text();
  let j = {}; try { j = JSON.parse(text); } catch (_) {}
  if (!r.ok) throw new Error(`AccessToken ${r.status}: ${text.slice(0, 200)}`);
  // Accept the common token field names.
  const token = j.accessToken || j.access_token || j.token || j.Token || (typeof j === 'string' ? j : '') || (text && !text.startsWith('{') ? text.trim() : '');
  if (!token) throw new Error(`AccessToken: no token field in response: ${text.slice(0, 200)}`);
  _tok = token;
  // expiresIn (sec) if provided, else assume 30 min.
  const ttl = (j.expiresIn || j.expires_in || 1800) * 1000;
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
