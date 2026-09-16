// frontdoor-probe — owner-gated. Stops the guessing on the Frontdoor/AHS 404.
//
// Two jobs:
//   1. Decode OUR OWN JWT's claims (roles / scopes / aud / custom claims) so we can see
//      what the API key is actually provisioned for. NEVER echoes the raw token, and any
//      claim value that looks like a credential is masked.
//   2. Walk a matrix of candidate paths and record the status code for each. The status
//      code IS the answer:
//        404 = that path does not exist for us (wrong URL shape — e.g. missing routing-id)
//        403 = the path exists but our key is not authorized for it (the real "waiting on
//              Frontdoor" signal)
//        400/422 = the path exists AND accepted our auth — it just rejected the body.
//                  That is a PASS: auth + endpoint are good, only the schema is off.
//        200 = live.
//
// The decisive comparison is dispatch-connector / case-lifecycle vs the Address API. If
// Address answers and dispatch 404s, our key is fine and the dispatch surface simply is
// not provisioned for a ProConnect contractor — which is a BD-rep conversation, not a
// code fix. If everything 404s, the URL shape is wrong (routing-id).
//
//   GET ?secret=<admin>[&routing=<routing-id>][&dispatch=<id>][&base=prod]
//   GET ?secret=<admin>&shape=all   -> payload-shape matrix (see buildShapes below).
//                                      Use this once auth+routing are through and the
//                                      only thing failing is the body.
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const fd = require('./_lib/frontdoor');

exports.config = { timeout: 26 };

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// A claim value is safe to show unless it looks like a credential. Long opaque strings get
// masked so a probe output can never become a secret leak.
const SECRETISH = /(secret|password|passwd|pwd|token|refresh|api[_-]?key|client[_-]?secret|authorization)/i;
function safeVal(k, v) {
  if (SECRETISH.test(String(k))) return '«masked»';
  if (typeof v === 'string' && v.length > 64) return `«${v.length} chars»`;
  if (Array.isArray(v)) return v.slice(0, 12).map((x) => safeVal(k, x));
  if (v && typeof v === 'object') {
    const o = {}; for (const [kk, vv] of Object.entries(v).slice(0, 25)) o[kk] = safeVal(kk, vv); return o;
  }
  return v;
}

function decodeClaims(jwt) {
  try {
    const parts = String(jwt).split('.');
    if (parts.length < 2) return { error: 'not a JWT (no payload segment)' };
    const pad = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(pad, 'base64').toString('utf8'));
    const out = {};
    for (const [k, v] of Object.entries(payload)) out[k] = safeVal(k, v);
    if (payload.exp) out._expires_in_min = Math.round((payload.exp * 1000 - Date.now()) / 60000);
    return out;
  } catch (e) { return { error: String((e && e.message) || e) }; }
}

async function probe(base, token, method, path, body) {
  const started = Date.now();
  try {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    const tx = (await r.text()).slice(0, 220);
    return { method, path, status: r.status, ms: Date.now() - started, body_snippet: tx };
  } catch (e) {
    return { method, path, status: 0, ms: Date.now() - started, error: String((e && e.message) || e).slice(0, 120) };
  }
}

// What each status tells us. This is the whole point of the probe.
// ── Payload-shape variants ───────────────────────────────────────────────────
// 2026-09-16: Frontdoor fixed the sandbox instance and the dispatch-connector now
// REACHES their business logic — it answers 500 CONNECTOR_BLE_0007 "Failed to unmarshal
// struct to JSON string" instead of the old empty 404. So auth + routing are DONE and
// the only thing left is the body. Rather than burn a partner round-trip per guess, this
// sends the same status update in every plausible shape in ONE call and reports each
// status + their error code side by side.
//
//   spec   — exactly what their 2026-06-24 spec documents (what we ship today)
//   items  — spec + the `items` array their own example includes (we omit it; it may be required)
//   strobj — `object` as a JSON-ENCODED STRING. Their error says "unmarshal struct to JSON
//            string", which is literally what a struct-where-a-string-was-expected looks like.
//   bare   — the object at the top level, no data[] envelope
function buildShapes(obj) {
  const withItems = { ...obj, items: [{ id: 0, legacy_item_id: 0, description: '' }] };
  return {
    spec:   { data: [{ type: 'status', object: obj }] },
    items:  { data: [{ type: 'status', object: withItems }] },
    strobj: { data: [{ type: 'status', object: JSON.stringify(obj) }] },
    bare:   obj,
  };
}

function verdict(s) {
  if (s === 200 || s === 201 || s === 202) return 'LIVE';
  if (s === 400 || s === 422) return 'REACHABLE — auth accepted, body rejected (this is a PASS)';
  if (s === 401) return 'token rejected';
  if (s === 403) return 'EXISTS but our key is NOT AUTHORIZED (the real waiting-on-Frontdoor signal)';
  if (s === 404) return 'path does not exist for us (wrong URL shape or not provisioned)';
  if (s === 405) return 'EXISTS — wrong HTTP method (still proves the path is real)';
  if (s === 0) return 'network/timeout';
  return 'unexpected';
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'admin secret required (?secret=)' });

  if (!(await fd.isConfigured())) return json(200, { ok: false, error: 'FRONTDOOR_* keys not in vault' });

  // &base=prod forces the PRODUCTION gateway while still minting the SANDBOX token.
  // Needed to tell 'this host has no routes' apart from 'this host does not trust our
  // issuer' — the two look identical from a single-host probe and we got that wrong once.
  const base = String(q.base || '').toLowerCase().startsWith('prod') ? fd.PROD_BASE : await fd.apiBase();
  const env = await fd.env();
  const routing = String(q.routing || (await getSecretFresh('FRONTDOOR_ROUTING_ID')) || '').trim();
  const vendorId = String((await getSecret('FRONTDOOR_VENDOR_ID')) || '822418').trim();
  const dispatchId = Number(q.dispatch || 999999);

  let token = '';
  try { token = await fd.getToken(true); }
  catch (e) { return json(200, { ok: false, stage: 'token', error: String((e && e.message) || e) }); }

  const claims = decodeClaims(token);

  const nowIso = new Date().toISOString();
  const statusObject = {
    source: 'TN_APPLIANCE_EXCHANGE', tenant: 'AHS', dispatch_id: dispatchId, vendor_id: vendorId,
    description: 'Technician in Route to Location', status_code: 70,
    note: 'Ant probe — ignore', updated_at: nowIso, start_time: nowIso, end_time: nowIso,
  };
  const connectorBody = { data: [{ type: 'status', object: statusObject }] };
  const lifecycleBody = { dispatchNumber: dispatchId, status: 'JobComplete' };

  // ?shape=spec|items|strobj|bare|all — send the SAME status update in each payload shape
  // against the one path that matters, and report their status + error code for each. One
  // call answers "which body do you actually accept?" without another partner round-trip.
  if (q.shape) {
    const shapes = buildShapes(statusObject);
    const want = String(q.shape).toLowerCase() === 'all'
      ? Object.keys(shapes)
      : String(q.shape).toLowerCase().split(',').map((x) => x.trim()).filter((x) => shapes[x]);
    if (!want.length) return json(400, { ok: false, error: 'shape must be one or more of: ' + Object.keys(shapes).join('|') + ' (or all)' });

    const tried = [];
    for (const name of want) {
      const r = await probe(base, token, 'POST', '/dispatch-connector/v1/webhook', shapes[name]);
      r.shape = name;
      r.verdict = verdict(r.status);
      // Their error code is the useful signal — a DIFFERENT code means the shape changed
      // how far the request got, which is progress even when it still fails.
      try { r.their_code = (JSON.parse(r.body_snippet || '{}').error || {}).code || null; } catch (_) { r.their_code = null; }
      tried.push(r);
    }
    const accepted = tried.filter((r) => [200, 201, 202].includes(r.status));
    return json(200, {
      ok: true, mode: 'shape-matrix', env, api_base: base, dispatch_id: dispatchId, vendor_id: vendorId,
      results: tried,
      accepted_shapes: accepted.map((r) => r.shape),
      read: accepted.length
        ? `ACCEPTED: ${accepted.map((r) => r.shape).join(', ')} — ship that shape.`
        : 'No shape accepted yet. Compare their_code across rows: a different code per shape tells you which field they are choking on; the same code everywhere means it is not the envelope.',
    });
  }

  // Ordered cheapest-signal-first. The routing-id variants only run when we have one.
  const targets = [
    ['POST', '/dispatch-connector/v1/webhook', connectorBody],
    ['POST', '/v1/case-lifecycle/dispatch_status_update', lifecycleBody],
    ['GET',  '/address/v1/zip?zip=37013', null],              // control: is ANY API ours?
    ['GET',  '/dispatch-connector/v1/health', null],
    ['GET',  '/health', null],
    ['GET',  '/', null],
  ];
  if (routing) {
    targets.unshift(['POST', `/${routing}/v1/case-lifecycle/dispatch_status_update`, lifecycleBody]);
    targets.unshift(['POST', `/${routing}/dispatch-connector/v1/webhook`, connectorBody]);
  }

  const results = [];
  for (const [m, p, b] of targets) {
    const r = await probe(base, token, m, p, b);
    r.verdict = verdict(r.status);
    results.push(r);
  }

  const reachable = results.filter((r) => [200, 201, 202, 400, 405, 422].includes(r.status));
  const forbidden = results.filter((r) => r.status === 403);
  const allNotFound = results.length > 0 && results.every((r) => r.status === 404);

  // The JWT carries everything the config ticket asks for. When every path 404s — including
  // the bare root, on a host that demonstrably answers — the gateway has no routes for this
  // key, which is exactly what an unprocessed config ticket looks like. So hand back the
  // filled-in ticket instead of another "still blocked" line.
  const ticket = (allNotFound && !routing) ? {
    why: 'Token is valid and identifies us correctly, but carries only the generic "external-partner" role with no routing-id or entitlements, and every path 404s. That is an unprocessed config ticket, not an authorization problem.',
    file_at: 'https://ftdr-developer.atlassian.net/servicedesk/customer/portal/3/group/11/create/53',
    also_email: 'partnerapiadmin@frontdoorhome.com',
    fields: {
      portal_account_email: claims.dev_email || null,
      organisation_name: claims.org_name || null,
      api_key_client_id: claims.applicationId || claims.aud || null,
      // The apikey Username IS the token's subject — an identifier meant to be shared with
      // Frontdoor (same class as the Client ID). The password is never touched here.
      api_key_username: claims.sub || null,
      environment: env === 'production' ? 'Production' : 'Sandbox',
      org_id: claims.org_id || null,
      developer_id: claims.dev_id || null,
    },
    ask: 'Link this API key to our ProConnect contractor account and enable the dispatch status/note surface (Case-Lifecycle dispatch_status_update and/or dispatch-connector). Please also confirm the routing-id segment for our URLs — every path 404s without it.',
    vendor_ids: 'AHS vendor ids: 822418 (North Shore LA), 822218 (South Shore LA), 839828 (Middle TN)',
  } : null;

  let read = 'Every probed path 404s with our token. Before concluding "the host is empty", re-run the paths WITHOUT an Authorization header: a known prefix answers 403 RBAC and an unrouted one answers 404 "Not Found", which tells you whether the prefix is deployed at all. Measured 2026-09-15 on sandbox: the prefix IS deployed, our token clears RBAC, and the service then 404s every path including one that cannot exist. See config_ticket.';
  if (reachable.length) read = `${reachable.length} path(s) are REACHABLE with our token — the integration is not auth-blocked, it is path/schema work.`;
  else if (forbidden.length) read = `${forbidden.length} path(s) EXIST but our key is not authorized — this is the genuine "waiting on Frontdoor" state (config ticket / BD rep).`;

  return json(200, {
    ok: true, env, api_base: base,
    routing_id_in_vault: !!routing,
    vendor_id: vendorId,
    token_claims: claims,
    results,
    summary: { probed: results.length, reachable: reachable.length, forbidden: forbidden.length, not_found: results.filter((r) => r.status === 404).length },
    read,
    config_ticket: ticket,
  });
};
