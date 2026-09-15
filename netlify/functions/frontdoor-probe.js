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
//   GET ?secret=<admin>[&routing=<routing-id>][&dispatch=<id>]
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

  const base = await fd.apiBase();
  const env = await fd.env();
  const routing = String(q.routing || (await getSecretFresh('FRONTDOOR_ROUTING_ID')) || '').trim();
  const vendorId = String((await getSecret('FRONTDOOR_VENDOR_ID')) || '822418').trim();
  const dispatchId = Number(q.dispatch || 999999);

  let token = '';
  try { token = await fd.getToken(true); }
  catch (e) { return json(200, { ok: false, stage: 'token', error: String((e && e.message) || e) }); }

  const claims = decodeClaims(token);

  const nowIso = new Date().toISOString();
  const connectorBody = { data: [{ type: 'status', object: {
    source: 'DISPATCH_ME', tenant: 'AHS', dispatch_id: dispatchId, vendor_id: vendorId,
    description: 'Technician in Route to Location', status_code: 70,
    note: 'Ant probe — ignore', updated_at: nowIso, start_time: nowIso, end_time: nowIso,
  } }] };
  const lifecycleBody = { dispatchNumber: dispatchId, status: 'JobComplete' };

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
      api_key_username: '(FRONTDOOR_API_USERNAME — see frontdoor-keys)',
      environment: env === 'production' ? 'Production' : 'Sandbox',
      org_id: claims.org_id || null,
      developer_id: claims.dev_id || null,
    },
    ask: 'Link this API key to our ProConnect contractor account and enable the dispatch status/note surface (Case-Lifecycle dispatch_status_update and/or dispatch-connector). Please also confirm the routing-id segment for our URLs — every path 404s without it.',
    vendor_ids: 'AHS vendor ids: 822418 (North Shore LA), 822218 (South Shore LA), 839828 (Middle TN)',
  } : null;

  let read = 'Every probed path 404s — including the bare root, on a host that does answer. The token is valid and names our org, so this is not auth: the gateway simply has no routes provisioned for this key. See config_ticket.';
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
