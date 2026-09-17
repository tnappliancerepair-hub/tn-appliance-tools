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
const vendorCtx = require('./vendor-ctx');

let _tok = null, _tokExp = 0;

// Default sandbox until production access is granted. Set vault FRONTDOOR_ENV=production
// (with prod keys) to flip live. Must match what the vaulted FRONTDOOR_* keys are for.
async function env() { return ((await getSecretFresh('FRONTDOOR_ENV')) || 'sandbox').toLowerCase(); }
// A connected TENANT is a real, production Frontdoor contractor — force production endpoints
// under an override (unless the override explicitly says sandbox). TN's path uses the vault env.
async function useSandbox() {
  const ov = vendorCtx.current('ahs');
  if (ov && ov.client_id) return String(ov.env || '').toLowerCase() === 'sandbox';
  return (await env()) === 'sandbox';
}
async function tokenUrl() {
  return (await useSandbox())
    ? 'https://frontdoorhome-dev.fusionauth.io/oauth2/token'
    : 'https://login.frontdoorhome.com/oauth2/token';
}
async function apiBase() {
  return (await useSandbox())
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
  // per-tenant override (inside runAsTenant); never share TN's cached token with a tenant.
  const ov = vendorCtx.current('ahs');
  const override = !!(ov && ov.client_id);
  if (!force && !override && _tok && Date.now() < _tokExp - 60000) return _tok;
  const clientId = String(ov.client_id || await getSecretFresh('FRONTDOOR_CLIENT_ID') || '').trim();
  const username = String(ov.api_username || await getSecretFresh('FRONTDOOR_API_USERNAME') || '').trim();
  const password = String(ov.api_password || await getSecretFresh('FRONTDOOR_API_PASSWORD') || '').trim();
  if (!clientId || !username || !password) throw new Error('Frontdoor API keys not available (tenant override or vault FRONTDOOR_CLIENT_ID / FRONTDOOR_API_USERNAME / FRONTDOOR_API_PASSWORD)');

  const form = new URLSearchParams();
  form.set('grant_type', 'password');   // STATIC per spec
  form.set('client_id', clientId);
  form.set('username', username);
  form.set('password', password);

  const r = await fetch(await tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(), signal: AbortSignal.timeout(6000),
  });
  const text = await r.text();
  let j = {}; try { j = JSON.parse(text); } catch (_) {}
  if (!r.ok) throw new Error(`Frontdoor token ${r.status}: ${text.slice(0, 220)}`);
  const token = j.access_token || j.accessToken || j.token;
  if (!token) throw new Error(`Frontdoor token: no access_token in response: ${text.slice(0, 200)}`);
  if (!override) { _tok = token; _tokExp = Date.now() + (j.expires_in || 3600) * 1000; }   // cache TN only
  return token;
}

async function api(method, path, bodyObj, baseOverride) {
  const base = baseOverride || await apiBase();
  const token = await getToken();
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    signal: AbortSignal.timeout(7000),
  });
  if (r.status === 401) {   // token expired mid-flight → one retry
    const t2 = await getToken(true);
    const r2 = await fetch(`${base}${path}`, {
      method, headers: { Authorization: `Bearer ${t2}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: bodyObj ? JSON.stringify(bodyObj) : undefined, signal: AbortSignal.timeout(7000),
    });
    const tx2 = await r2.text(); let j2 = {}; try { j2 = JSON.parse(tx2); } catch (_) {}
    return { ok: r2.ok, status: r2.status, data: j2, raw: tx2 };
  }
  const tx = await r.text(); let j = {}; try { j = JSON.parse(tx); } catch (_) {}
  return { ok: r.ok, status: r.status, data: j, raw: tx };
}

// Push a dispatch status update (+ optional note) into Frontdoor.
//   POST /dispatch-connector/v1/webhook
// baseOverride lets a caller probe a specific gateway regardless of FRONTDOOR_ENV. Needed
// because on SANDBOX our token clears RBAC and then every path under the prefix returns an
// empty 404, control path included (the prefix IS routed there — unauth gives 403 RBAC) — so a
// watcher pointed at sandbox would wait forever on a host that serves nothing. The real
// dispatch-connector service is on production.
async function dispatchStatusUpdate({ dispatchId, statusCode, description, note, vendorId, source, tenant, items, username, startTime, endTime, baseOverride }) {
  const vid = vendorId || vendorCtx.current('ahs').vendor_id || (await getSecret('FRONTDOOR_VENDOR_ID')) || '';
  // Refuse rather than send an empty vendor. Measured 2026-09-17: a blank vendor_id comes
  // back as 400 CONNECTOR_BLE_0030 "VendorID missing", which reads like a Frontdoor problem
  // and is actually our own unset config. FRONTDOOR_VENDOR_ID is empty in the vault, so any
  // caller that does not resolve one itself lands here -- frontdoor-push-job does resolve it
  // from the job's area, frontdoor-test did not. Fail with the fix in the message.
  if (!String(vid).trim()) {
    throw new Error('Frontdoor push needs a vendor_id -- pass vendorId, or set FRONTDOOR_VENDOR_ID. Ours: '
      + Object.entries(VENDOR_AREAS).map(([v, m]) => v + ' (' + m.area + ')').join(', '));
  }
  const nowIso = new Date().toISOString();
  const desc = description || '';

  // THE BODY THEIR CONNECTOR ACTUALLY SAVES. Measured against their sandbox 2026-09-17
  // after Akshay Kyatam sent the payload that works in their environment.
  //
  // It is the envelope their spec documented all along -- { data: [ { type, object } ] }.
  // The envelope was never the problem. What killed it for fifteen days is one JSON TYPE,
  // and the two adjacent id fields want OPPOSITE types, which is not guessable:
  //
  //   status_code "70"   (STRING)  -> 200        |  status_code 70   (number) -> 500 BLE_0007
  //   dispatch_id 22863999 (NUMBER) -> 200       |  dispatch_id "..." (string) -> 500 BLE_0007
  //
  // Optional, measured: items[] and username are both fine to omit (200 either way), and
  // start_time / end_time ride along without upsetting unmarshal. Reproduce any row with
  // frontdoor-probe?secret=<admin>&shape=ak_exact,ak_numcode,ak_strid (one shape per call).
  //
  // 200 IS NOT PROOF OF A SAVE. Akshay, 2026-09-17: "the API still returned a 200 response
  // even for incorrect request... we'll need to investigate that further." Our 2026-09-16
  // flat-envelope {type, data:{external_id, message, status}} returned 200 {"errors":null}
  // on every call and wrote NOTHING to the Contractor Portal. That shape is deliberately
  // gone from this file rather than parked behind a vault flag: a one-line "reversal" to a
  // body that silently no-ops is worse than having no reversal at all. It survives only in
  // frontdoor-probe, where a diagnostic belongs. FRONTDOOR_LEGACY_SHAPE is now inert.
  const object = {
    // Frontdoor (Akshay Kyatam) told us this exact value on 2026-08-24: "please use the
    // following value as the source in the request payload when calling our webhook API:
    // TN_APPLIANCE_EXCHANGE". The old 'DISPATCH_ME' was a guess copied out of the public
    // enum in the spec and was never what they provisioned for us.
    source: source || FD_SOURCE,
    tenant: tenant || 'AHS',
    dispatch_id: Number(dispatchId),
    vendor_id: String(vid),
    description: desc,
    // A STRING. This one character class is what the whole integration hung on.
    status_code: String(statusCode),
    note: note || '',
    // Who made the change, as it reads in their Contractor Portal. Optional to them; we
    // send the tech's name when we have it so a status has a person on it.
    username: username || 'TN APPLIANCE EXCHANGE',
    updated_at: nowIso,
    start_time: startTime || nowIso,
    end_time: endTime || nowIso,
  };
  if (Array.isArray(items) && items.length) object.items = items;

  const body = { data: [{ type: 'status', object }] };

  const call = api('POST', '/dispatch-connector/v1/webhook', body, baseOverride);
  const deadline = new Promise((_, rej) => setTimeout(() => rej(new Error('Frontdoor push deadline exceeded (16s)')), 16000));
  return Promise.race([call, deadline]);
}

// Status-code catalog. Frontdoor's full vocabulary is 47 codes (see the spec doc); these
// are the ones a CONTRACTOR reports. The rest are Frontdoor's own to set -- authorization
// decisions (350/360/370/450/470/480), cash-out (500), CIL (320/330/340) and the
// customer-side appointment/survey codes -- so we want to RECEIVE those on the webhook,
// not push them. Sending a status that is the warranty company's decision to make is how
// an integration gets its credentials pulled.
//
// THREE TIERS, and the difference is load-bearing when we tell a partner what is automatic:
//   wired:true  -- a real call site in tech-job.html sends this on a tech tap TODAY.
//   mapped:true -- present in FD_STATUS_MAP but NOTHING passes that key yet. One call site
//                  away from live. A map entry is NOT proof of wiring -- claiming these as
//                  automatic is exactly the overclaim that put a wrong status on Frontdoor's
//                  test dispatch, so they get their own tier.
//   neither     -- in the vocabulary, probes clean, needs an office-side trigger.
// Never tell a partner a status is automatic unless it says wired:true here.
const STATUS = {
  // --- wired: a live call site fires these on a tech tap today (verified by grepping the
  // actual lifecycle()/pushSP() invocations, not the map -- see the tier note above)
  EN_ROUTE: { code: 70, description: 'Technician in Route to Location', wired: true },   // a-otw tap
  IN_PROGRESS: { code: 20, description: 'In Progress', wired: true },                    // job started
  COMPLETE: { code: 10, description: 'Job Complete', wired: true },                      // job closed

  // --- mapped in FD_STATUS_MAP but no code path passes the key yet. One call site from live.
  ARRIVED: { code: 90, description: 'Technician Arrived at Location', mapped: true },
  PARTS_ORDERED: { code: 380, description: 'Parts Ordered', mapped: true },
  PARTS_ON_ORDER: { code: 100, description: 'In Progress with Parts on Order', mapped: true },
  RETURN_SET: { code: 400, description: 'Return Appointment Set', mapped: true },
  ON_HOLD: { code: 150, description: 'On Hold', mapped: true },
  PARTS_ARRIVED: { code: 410, description: 'Parts Arrived' },   // office parts flow, not the tech tap

  // --- in the connector, awaiting an office-side trigger
  APPOINTMENT_SET: { code: 30, description: 'Appointment Set' },
  AUTH_REPORTED: { code: 290, description: 'Authorization Reported' },
  INVOICED: { code: 440, description: 'Job Invoiced' },
  CANCELLED: { code: 40, description: 'Job Cancelled' },

  // --- added 2026-09-17: every one maps to a signal this system ALREADY produces, so they
  // are a wiring job, not a build. Descriptions are verbatim from Frontdoor's published
  // list; we ask them to confirm each pair rather than assume our wording is theirs.
  DISPATCH_ACCEPTED: { code: 260, description: 'Dispatch Accepted' },          // auto-accept
  UNABLE_TO_CONTACT: { code: 60, description: 'Unable to Contact Customer' },  // intake no-reply
  LEFT_MESSAGE: { code: 280, description: 'Left message for Customer' },       // voicemail / callback
  DELAYED: { code: 80, description: 'Technician May Be Delayed' },             // tech-late watcher
  CUSTOMER_MISSED: { code: 120, description: 'Customer Missed Appointment' },  // no-show check
  RESCHEDULED: { code: 270, description: 'Reschedule Appointment Set' },       // reschedule_job
  NEED_TO_REPLACE: { code: 110, description: 'In Progress w/ Need to Replace' }, // not_fixable TDR
  PARTS_STATUS: { code: 160, description: 'Parts/Equipment Status' },          // parts ETA update
  INCOMPLETE: { code: 140, description: 'Incomplete' },                        // visit ended unfinished
  SECOND_OPINION: { code: 460, description: '2nd Opinion Requested' },
};

// Frontdoor's decisions, not ours. Listed so nobody wires a push for one by mistake, and
// so the inbound webhook has a name for what it should be RECEIVING.
const INBOUND_STATUS = {
  350: 'Authorization Approved',
  360: 'Authorization Denied',
  370: 'Authorization Approved w/ Limitations',
  450: 'Authorization Awaiting Contractor Input',
  470: 'Draft Autho for Contractor Review',
  480: 'Autho Review with Agent',
  500: 'Cash out Approved',
  320: 'CIL Offered', 330: 'CIL Accepted', 340: 'CIL Declined',
  300: 'Appliance Options Offered', 310: 'Appliance Replaced',
  130: 'Possible Denial', 50: 'Automated Dispatch Load Successful', 250: 'Dispatch Assigned',
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

// Measured 2026-09-15: production routes by PREFIX and /dispatch-connector is live +
// JWT-gated there; on api.sandbox.frontdoorhome.com the same prefix is routed but answers an
// empty 404 for every path we can reach, so it can never return a positive signal.
const PROD_BASE = 'https://api.frontdoorhome.com';
// The `source` Frontdoor provisioned for our account. Override per-tenant if a shop is ever
// onboarded under a different contractor identity.
const FD_SOURCE = 'TN_APPLIANCE_EXCHANGE';

module.exports = { PROD_BASE, FD_SOURCE, isConfigured, getToken, api, dispatchStatusUpdate, caseLifecycleStatusUpdate, STATUS, INBOUND_STATUS, env, apiBase, VENDOR_AREAS, areaForVendor, vendorForArea };
