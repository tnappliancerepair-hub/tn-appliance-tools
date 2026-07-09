// frontdoor.js — connector for the Frontdoor / AHS API (push job status + notes into
// the Frontdoor portal → eliminates Danielle's manual portal updating).
//
// Auth: OAuth2 password grant via FusionAuth → JWT Bearer (1-hour expiry, cached).
// API Keys (ClientId/Username/Password) are generated in the Frontdoor DEVELOPER PORTAL
// ("Add API Key") — which we do NOT have access to yet, so this stays DARK
// (configured:false) until the FRONTDOOR_* secrets land in the vault.
//
// Vault (via getSecret, env-first then Xano app_config):
//   FRONTDOOR_CLIENT_ID        - apikey ClientId (environment-specific!)
//   FRONTDOOR_API_USERNAME     - apikey Username
//   FRONTDOOR_API_PASSWORD     - apikey Password
//   FRONTDOOR_VENDOR_ID        - our contractor/vendor id (for dispatch payloads)
//   FRONTDOOR_ENV              - 'production' (default) | 'sandbox'
//
// Spec: docs/frontdoor-api-spec-2026-06-24.md
'use strict';

const { getSecret, getSecretFresh } = require('./secrets');

let _tok = null, _tokExp = 0;

// Default sandbox until production access is granted. Set vault FRONTDOOR_ENV=production
// (with prod keys) to flip live. Must match what the vaulted FRONTDOOR_* keys are for.
async function env() { return ((await getSecretFresh('FRONTDOOR_ENV')) || 'sandbox').toLowerCase(); }
async function tokenUrl() {
  return (await env()) === 'sandbox'
    ? 'https://frontdoorhome-dev.fusionauth.io/oauth2/token'
    : 'https://login.frontdoorhome.com/oauth2/token';
}
async function apiBase() {
  return (await env()) === 'sandbox'
    ? 'https://api.sandbox.frontdoorhome.com'
    : 'https://api.frontdoorhome.com';
}

// True only when all three API-key secrets are present in the vault.
async function isConfigured() {
  const [c, u, p] = await Promise.all([
    getSecret('FRONTDOOR_CLIENT_ID'), getSecret('FRONTDOOR_API_USERNAME'), getSecret('FRONTDOOR_API_PASSWORD'),
  ]);
  return !!(c && u && p);
}

async function getToken(force) {
  if (!force && _tok && Date.now() < _tokExp - 60000) return _tok;
  const clientId = String(await getSecretFresh('FRONTDOOR_CLIENT_ID') || '').trim();
  const username = String(await getSecretFresh('FRONTDOOR_API_USERNAME') || '').trim();
  const password = String(await getSecretFresh('FRONTDOOR_API_PASSWORD') || '').trim();
  if (!clientId || !username || !password) throw new Error('Frontdoor API keys not in vault (FRONTDOOR_CLIENT_ID / FRONTDOOR_API_USERNAME / FRONTDOOR_API_PASSWORD)');

  const form = new URLSearchParams();
  form.set('grant_type', 'password');   // STATIC per spec
  form.set('client_id', clientId);
  form.set('username', username);
  form.set('password', password);

  const r = await fetch(await tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(), signal: AbortSignal.timeout(12000),
  });
  const text = await r.text();
  let j = {}; try { j = JSON.parse(text); } catch (_) {}
  if (!r.ok) throw new Error(`Frontdoor token ${r.status}: ${text.slice(0, 220)}`);
  const token = j.access_token || j.accessToken || j.token;
  if (!token) throw new Error(`Frontdoor token: no access_token in response: ${text.slice(0, 200)}`);
  _tok = token;
  const ttl = (j.expires_in || 3600) * 1000;   // JWT valid 1 hour
  _tokExp = Date.now() + ttl;
  return token;
}

async function api(method, path, bodyObj) {
  const base = await apiBase();
  const token = await getToken();
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 401) {   // token expired mid-flight → one retry
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

// Push a dispatch status update (+ optional note) into Frontdoor.
//   POST /dispatch-connector/v1/webhook
async function dispatchStatusUpdate({ dispatchId, statusCode, description, note, vendorId, source, tenant, items, startTime, endTime }) {
  const vid = vendorId || (await getSecret('FRONTDOOR_VENDOR_ID')) || '';
  const nowIso = new Date().toISOString();
  const object = {
    source: source || 'DISPATCH_ME',
    tenant: tenant || 'AHS',
    dispatch_id: Number(dispatchId),
    vendor_id: String(vid),
    description: description,
    status_code: Number(statusCode),
    note: note || '',
    updated_at: nowIso,
    start_time: startTime || nowIso,
    end_time: endTime || nowIso,
  };
  if (Array.isArray(items) && items.length) object.items = items;
  return api('POST', '/dispatch-connector/v1/webhook', { data: [{ type: 'status', object }] });
}

// Status-code catalog (subset we use) — see spec doc for the full list.
const STATUS = {
  APPOINTMENT_SET: { code: 30, description: 'Appointment Set' },
  EN_ROUTE: { code: 70, description: 'Technician in Route to Location' },
  ARRIVED: { code: 90, description: 'Technician Arrived at Location' },
  IN_PROGRESS: { code: 20, description: 'In Progress' },
  PARTS_ON_ORDER: { code: 100, description: 'In Progress with Parts on Order' },
  PARTS_ORDERED: { code: 380, description: 'Parts Ordered' },
  PARTS_ARRIVED: { code: 410, description: 'Parts Arrived' },
  RETURN_SET: { code: 400, description: 'Return Appointment Set' },
  AUTH_REPORTED: { code: 290, description: 'Authorization Reported' },
  COMPLETE: { code: 10, description: 'Job Complete' },
  INVOICED: { code: 440, description: 'Job Invoiced' },
  CANCELLED: { code: 40, description: 'Job Cancelled' },
  ON_HOLD: { code: 150, description: 'On Hold' },
};

// Case-Lifecycle status update — the SIMPLER contractor endpoint from the Getting
// Started docs. POST /<routing-id>/v1/case-lifecycle/dispatch_status_update
//   body: { dispatchNumber, status }   (status is camelCase, e.g. "JobComplete")
// routingId + the exact status vocabulary come from the API-key CONFIG TICKET / sandbox.
async function caseLifecycleStatusUpdate({ dispatchNumber, status, routingId }) {
  const rid = routingId || (await getSecret('FRONTDOOR_ROUTING_ID')) || '';
  const path = (rid ? `/${rid}` : '') + '/v1/case-lifecycle/dispatch_status_update';
  return api('POST', path, { dispatchNumber: Number(dispatchNumber), status: String(status) });
}

// Our Frontdoor vendor IDs → service area + tech cluster (confirmed 2026-07-09 from the
// contractor portal + dispatch-email addresses; see docs/frontdoor-integration-spec).
// Three active appliance accounts, one per area; 1373302/120868 are legacy/inactive.
// Used to auto-route an inbound dispatch to the right crew, and to echo the correct
// vendor_id back on a status push (keyed off the job's area).
const VENDOR_AREAS = {
  '822418': { area: 'North Shore', state: 'LA', cluster: 'LA North', lead_tech_id: 6 }, // John
  '822218': { area: 'South Shore', state: 'LA', cluster: 'LA South', lead_tech_id: 3 }, // Andre
  '839828': { area: 'Middle TN',   state: 'TN', cluster: 'TN Metro', lead_tech_id: 2 }, // Jimmy/Lee
};
function areaForVendor(vendorId) {
  return VENDOR_AREAS[String(vendorId || '').trim()] || null;
}
// Reverse: given a job's area name, the vendor_id we push status back under.
function vendorForArea(area) {
  const a = String(area || '').trim().toLowerCase();
  for (const [vid, meta] of Object.entries(VENDOR_AREAS)) {
    if (meta.area.toLowerCase() === a) return vid;
  }
  return null;
}

module.exports = { isConfigured, getToken, api, dispatchStatusUpdate, caseLifecycleStatusUpdate, STATUS, env, apiBase, VENDOR_AREAS, areaForVendor, vendorForArea };
