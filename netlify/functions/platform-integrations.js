// platform-integrations — a shop connects its OWN vendor accounts (Model A / BYOC). Auth is the
// tenant's Supabase session (Bearer) -> app_user -> company_id + role; only owner/office/manager/
// admin may manage credentials. Creds are POSTed once over HTTPS, encrypted immediately by
// tenant-creds (AES-256-GCM, key in OUR vault), stored as ciphertext, and NEVER returned to the
// browser — the UI only ever sees connection STATUS. Connecting stores + (optionally) verifies;
// no automation runs off these yet (SHADOW — the shared vendor libs still default to TN's vault).
//   POST ?action=catalog|list|connect|disconnect|verify   (Bearer <supabase jwt>)
'use strict';
const { getSecret } = require('./_lib/secrets');
const tc = require('./_lib/tenant-creds');
const PLATFORM_ANON = 'sb_publishable_gtcSGgZWhqkrUxdPxFhKrA_CwUBcyq7';
const MANAGE_ROLES = new Set(['owner', 'office', 'manager', 'admin']);
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type' }, body: JSON.stringify(b) }; }

// The vendors a shop can connect + the (non-secret-labeled) fields each needs. Data-driven so
// the UI renders forms without hardcoding. `secret` fields are write-only (never read back).
const VENDORS = {
  servicepower: { label: 'ServicePower / SquareTrade', note: 'Warranty dispatch + claims (SquareTrade, Allstate).',
    portal: 'https://my.servicepower.com', where: 'From your ServicePower account: your ServiceDispatch User ID + password are your normal login; your Servicer account number (e.g. TNA00001) is on your account/profile page. Not sure? Your ServicePower rep can confirm it.',
    fields: [ { k: 'user_id', label: 'ServiceDispatch User ID' }, { k: 'password', label: 'Password', secret: true }, { k: 'servicer_acct', label: 'Servicer account (e.g. TNA00001)' } ] },
  ahs: { label: 'American Home Shield / Frontdoor', note: 'AHS dispatch + status push.',
    portal: 'https://developer.frontdoorhome.com', where: 'From the Frontdoor Developer Portal (developer.frontdoorhome.com): generate an API key to get your Client ID + API username/password. Your Vendor ID is the number Frontdoor dispatches to (on your ProConnect profile). New to the dev portal? Frontdoor partner support provisions access.',
    fields: [ { k: 'client_id', label: 'Frontdoor Client ID' }, { k: 'api_username', label: 'API username' }, { k: 'api_password', label: 'API password', secret: true }, { k: 'vendor_id', label: 'Vendor ID' } ] },
  marcone: { label: 'Marcone / mSupply (parts)', note: 'OEM parts pricing, stock + drop-ship ordering.',
    portal: 'https://my.marcone.com', where: 'From the mSupply / Marcone developer portal (api.msupply.com): create an app to get your Client ID + Client Secret. Your Customer # is your Marcone account number (top of your Marcone invoices). Your Marcone rep can enable API access if you don\'t see it.',
    fields: [ { k: 'client_id', label: 'mSupply Client ID' }, { k: 'client_secret', label: 'mSupply Client Secret', secret: true }, { k: 'customer_no', label: 'Customer #' } ] },
  nsa: { label: 'NSA (National Service Alliance)', note: 'Warranty dispatch (portal).',
    portal: 'https://www.nationalservicealliance.com', where: 'Your NSA contractor portal username + password — the same login you use for the NSA portal today.',
    fields: [ { k: 'portal_user', label: 'Portal username' }, { k: 'portal_pass', label: 'Portal password', secret: true } ] },
};

async function caller(event) {
  const base = (await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  const m = String((event.headers || {}).authorization || (event.headers || {}).Authorization || '').match(/Bearer\s+(.+)/i);
  if (!m) return null;
  try {
    const ur = await fetch(`${base.replace(/\/+$/, '')}/auth/v1/user`, { headers: { Authorization: 'Bearer ' + m[1], apikey: PLATFORM_ANON }, signal: AbortSignal.timeout(8000) });
    if (!ur.ok) return null;
    const u = await ur.json().catch(() => null); if (!u || !u.id) return null;
    const H = { apikey: key, Authorization: 'Bearer ' + key };
    const ar = await fetch(`${base.replace(/\/+$/, '')}/rest/v1/app_user?auth_user_id=eq.${u.id}&select=company_id,role&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) });
    const a = ((await ar.json().catch(() => []))[0]);
    return a ? { company_id: a.company_id, role: (a.role || '').toLowerCase() } : null;
  } catch (_) { return null; }
}

// Lightweight per-vendor credential probe. Marcone is implemented (clean OAuth2 token mint);
// others return {ok:null} = "stored, auto-verify not wired yet" (honest, not a failure).
async function verifyVendor(vendor, creds) {
  try {
    if (vendor === 'marcone') {
      const r = await fetch('https://api.msupply.com/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.client_id || '', client_secret: creds.client_secret || '' }),
        signal: AbortSignal.timeout(9000),
      });
      return { ok: r.ok, detail: r.ok ? 'token minted' : ('auth ' + r.status) };
    }
  } catch (e) { return { ok: false, detail: String((e && e.message) || e).slice(0, 80) }; }
  return { ok: null, detail: 'stored — auto-verify not wired for this vendor yet' };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  const q = event.queryStringParameters || {};
  const action = String(q.action || 'list');
  if (action === 'catalog') return json(200, { ok: true, vendors: VENDORS });

  const who = await caller(event);
  if (!who) return json(403, { ok: false, error: 'not_signed_in' });

  if (action === 'list') return json(200, { ok: true, integrations: await tc.listIntegrations(who.company_id) });

  // everything below mutates credentials -> require a manage role
  if (!MANAGE_ROLES.has(who.role)) return json(403, { ok: false, error: 'insufficient_role', note: 'only owner/office/manager may connect accounts' });

  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const vendor = String(body.vendor || q.vendor || '').toLowerCase();
  if (!VENDORS[vendor]) return json(400, { ok: false, error: 'unknown_vendor' });

  if (action === 'disconnect') {
    await tc.deleteIntegration(who.company_id, vendor);
    return json(200, { ok: true, disconnected: vendor });
  }

  if (action === 'connect') {
    const creds = body.creds || {};
    // keep only known fields; strip anything unexpected. meta = the non-secret fields for display.
    const spec = VENDORS[vendor].fields;
    const clean = {}; const meta = {};
    spec.forEach((f) => { const v = creds[f.k]; if (v != null && String(v) !== '') { clean[f.k] = String(v); if (!f.secret) meta[f.k] = String(v); } });
    if (!Object.keys(clean).length) return json(400, { ok: false, error: 'no_credentials' });
    const doVerify = q.verify === '1' || body.verify === true;
    let status = 'stored', verified_at = null, last_error = null;
    if (doVerify) {
      const v = await verifyVendor(vendor, clean);
      if (v.ok === true) { status = 'connected'; verified_at = new Date().toISOString(); }
      else if (v.ok === false) { status = 'error'; last_error = v.detail; }
      else { status = 'stored'; last_error = v.detail; }
    }
    const ok = await tc.storeIntegration(who.company_id, vendor, { label: VENDORS[vendor].label, creds: clean, meta, status, verified_at, last_error });
    return json(200, { ok, vendor, status, verified_at, note: last_error || 'stored (encrypted)' });
  }

  if (action === 'verify') {
    const creds = await tc.getTenantVendorCreds(who.company_id, vendor);
    if (!creds) return json(200, { ok: false, error: 'not_connected' });
    const v = await verifyVendor(vendor, creds);
    const status = v.ok === true ? 'connected' : (v.ok === false ? 'error' : 'stored');
    await tc.storeIntegration(who.company_id, vendor, { label: VENDORS[vendor].label, meta: undefined, status, verified_at: v.ok === true ? new Date().toISOString() : null, last_error: v.ok === true ? null : v.detail });
    return json(200, { ok: v.ok !== false, vendor, status, detail: v.detail });
  }

  return json(400, { ok: false, error: 'unknown_action' });
};
