// Marcone API client — SKELETON. Fill in the endpoint paths + response field
// maps (the TODOs) from Marcone's API docs once access lands; the structure,
// auth, vault wiring, and Ant-facing shapes are done.
//
// Creds live in the Xano vault (set via admin-secrets.html), read VAULT-FIRST so
// we never fight Netlify's 4KB env cap — same pattern that unblocked Digits.
// Auth-agnostic: supports an API key OR OAuth2 client-credentials, whichever
// Marcone uses (confirm in the meeting; fill getAuthHeader()).
//
// Vault keys to set (admin-secrets.html):
//   MARCONE_API_BASE         e.g. https://api.marcone.com/v1   (from their docs)
//   MARCONE_API_KEY          if key-based auth
//   MARCONE_CLIENT_ID        \ if OAuth2
//   MARCONE_CLIENT_SECRET    /
//   MARCONE_ACCOUNT_NUMBER   our account # (so pricing = OUR cost)
'use strict';

const { getSecretPreferVault } = require('./secrets');

async function cfg() {
  const [base, apiKey, clientId, clientSecret, account] = await Promise.all([
    getSecretPreferVault('MARCONE_API_BASE'),
    getSecretPreferVault('MARCONE_API_KEY'),
    getSecretPreferVault('MARCONE_CLIENT_ID'),
    getSecretPreferVault('MARCONE_CLIENT_SECRET'),
    getSecretPreferVault('MARCONE_ACCOUNT_NUMBER'),
  ]);
  return { base: String(base || '').replace(/\/+$/, ''), apiKey, clientId, clientSecret, account };
}

async function isConnected() {
  const c = await cfg();
  return !!(c.base && (c.apiKey || (c.clientId && c.clientSecret)));
}

// OAuth token cache per warm container (only used if Marcone is OAuth2).
let _tok = { value: '', exp: 0 };
async function getAuthHeader(c) {
  if (c.apiKey) {
    // TODO(docs): confirm the header — Authorization: Bearer vs x-api-key vs other.
    return { Authorization: 'Bearer ' + c.apiKey };
  }
  if (c.clientId && c.clientSecret) {
    if (_tok.value && Date.now() < _tok.exp - 30000) return { Authorization: 'Bearer ' + _tok.value };
    // TODO(docs): confirm token URL + grant + body.
    const r = await fetch(`${c.base}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) throw new Error('marcone_oauth_failed: ' + (d.error_description || d.error || r.status));
    _tok = { value: d.access_token, exp: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
    return { Authorization: 'Bearer ' + _tok.value };
  }
  throw new Error('Marcone not configured (set MARCONE_API_BASE + MARCONE_API_KEY or CLIENT_ID/SECRET in the vault)');
}

// Generic request helper. Once endpoints are filled, lookup/placeOrder/orderStatus
// all go through this.
async function api(method, path, { query, body } = {}) {
  const c = await cfg();
  if (!c.base) throw new Error('MARCONE_API_BASE not set in the vault');
  const auth = await getAuthHeader(c);
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const r = await fetch(`${c.base}${path}${qs}`, {
    method, headers: { ...auth, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch (_) { json = { raw: text.slice(0, 400) }; }
  if (!r.ok) throw new Error(`marcone ${method} ${path} -> ${r.status}: ${String(text).slice(0, 200)}`);
  return json;
}

// ── Flow A: LOOKUP — model/part# → our cost, stock, ETA ───────────────────────
// Returns normalized candidates Ant already knows how to render:
//   [{ part_number, description, our_cost_cents, in_stock, qty, eta, brand }]
async function lookup(modelOrPart, { type = 'part' } = {}) {
  const c = await cfg();
  // TODO(docs): real path + params (model vs part search) + the account param name.
  const raw = await api('GET', '/parts/search', { query: { q: modelOrPart, type, account: c.account } });
  return normalizeLookup(raw);
}
function normalizeLookup(raw) {
  // TODO(docs): map Marcone's actual field names. Placeholder reads common shapes.
  const items = (raw && (raw.results || raw.items || raw.parts)) || [];
  return items.map((p) => ({
    part_number: p.partNumber || p.part_number || p.sku || '',
    description: p.description || p.desc || '',
    our_cost_cents: Math.round(Number(p.yourPrice || p.your_cost || p.price || 0) * 100),
    in_stock: !!(p.inStock ?? p.in_stock ?? (Number(p.quantity || p.qty || 0) > 0)),
    qty: Number(p.quantity || p.qty || 0),
    eta: p.eta || p.availability || p.shipDate || '',
    brand: p.brand || '',
  }));
}

// ── Flow B: ORDER — place an order, dropship to the customer ───────────────────
async function placeOrder({ part_number, qty = 1, ship_to, po, test = true }) {
  const c = await cfg();
  // ship_to: { name, street, city, state, zip, phone }
  // TODO(docs): real path + body shape + the dropship/ship-to fields + test flag.
  const raw = await api('POST', '/orders', {
    body: {
      account: c.account,
      test_mode: !!test,
      po_number: po || '',
      items: [{ part_number, quantity: qty }],
      ship_to,
    },
  });
  return { ok: true, order_number: raw.orderNumber || raw.order_number || raw.id || '', raw };
}

// ── Flow C: TRACK — order status + tracking (the parts-chase automation) ───────
async function orderStatus(orderNumber) {
  // TODO(docs): real path + response fields.
  const raw = await api('GET', `/orders/${encodeURIComponent(orderNumber)}`);
  return {
    order_number: orderNumber,
    status: raw.status || raw.orderStatus || '',
    tracking: raw.tracking || raw.trackingNumber || raw.tracking_number || '',
    eta: raw.eta || raw.estimatedDelivery || raw.deliveryDate || '',
    raw,
  };
}

module.exports = { cfg, isConnected, getAuthHeader, api, lookup, normalizeLookup, placeOrder, orderStatus };
