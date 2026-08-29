// platform-servicepower — the tenant-authed door to a shop's ServicePower connection.
//
// The shop connects its ServicePower account on integrations.html (creds encrypted per tenant by
// tenant-creds). This endpoint runs ServicePower AS that shop via servicepower-tenant, so the
// office can confirm the connection is live and later phases (pull dispatches, push status, file
// claims, reconcile payments) build on the same binding.
//
//   POST ?do=status                      -> is ServicePower connected for this shop?
//   POST ?do=ping                        -> live getCallInfo (1-day) as the shop -> authenticated?
//   POST ?do=claimcheck  { call }        -> retrieveClaims as the shop (proves claims is per-tenant)
//
// Auth: a Supabase session (Bearer) resolved to the caller's company + role — OR, for server-side
// tests, ?secret=<admin>&company=<uuid>. Reads only; no writes to ServicePower here.
'use strict';

const { getSecret } = require('./_lib/secrets');
const spTenant = require('./_lib/servicepower-tenant');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Content-Type': 'application/json' };
const PLATFORM_ANON = 'sb_publishable_gtcSGgZWhqkrUxdPxFhKrA_CwUBcyq7';
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

async function base() { return ((await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co').replace(/\/+$/, ''); }
async function svcKey() { return (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || ''; }

// resolve the caller to a company: session Bearer -> app_user, OR admin secret + &company=
async function resolveCompany(event, q) {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret && q.secret === admin && q.company) return { companyId: String(q.company), role: 'admin', via: 'secret' };
  const b = await base(); const key = await svcKey();
  const m = String((event.headers || {}).authorization || (event.headers || {}).Authorization || '').match(/Bearer\s+(.+)/i);
  if (!m) return null;
  try {
    const ur = await fetch(`${b}/auth/v1/user`, { headers: { Authorization: 'Bearer ' + m[1], apikey: PLATFORM_ANON }, signal: AbortSignal.timeout(8000) });
    if (!ur.ok) return null;
    const u = await ur.json().catch(() => null); if (!u || !u.id) return null;
    const H = { apikey: key, Authorization: 'Bearer ' + key };
    const ar = await fetch(`${b}/rest/v1/app_user?auth_user_id=eq.${u.id}&select=company_id,role&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) });
    const a = ((await ar.json().catch(() => []))[0]);
    return a ? { companyId: a.company_id, role: (a.role || '').toLowerCase(), via: 'session' } : null;
  } catch (_) { return null; }
}

async function connectionStatus(companyId) {
  const b = await base(); const key = await svcKey();
  const r = await fetch(`${b}/rest/v1/tenant_integration?company_id=eq.${companyId}&vendor=eq.servicepower&select=status,meta,verified_at,last_error,updated_at&limit=1`, { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(8000) });
  const row = r.ok ? ((await r.json().catch(() => []))[0]) : null;
  if (!row) return { connected: false, status: 'not_connected' };
  return { connected: row.status === 'connected', status: row.status, servicer_acct: (row.meta && row.meta.servicer_acct) || null, verified_at: row.verified_at || null, last_error: row.last_error || null };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  const q = event.queryStringParameters || {};
  const doo = String(q.do || 'status');
  let p = {}; try { p = JSON.parse(event.body || '{}'); } catch (_) {}

  const who = await resolveCompany(event, q);
  if (!who) return json(401, { ok: false, error: 'not_signed_in' });
  const companyId = who.companyId;

  if (doo === 'status') {
    return json(200, { ok: true, ...(await connectionStatus(companyId)) });
  }

  // both ping + claimcheck run AS the shop
  const sp = await spTenant.forCompany(companyId);
  if (!sp) return json(200, { ok: false, error: 'not_connected', note: 'connect ServicePower on integrations.html first' });

  if (doo === 'ping') {
    // a 1-day getCallInfo: a clean 200 with no auth error = the shop's creds authenticate.
    const now = new Date(), from = new Date(now.getTime() - 24 * 3600 * 1000);
    const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()} 00:00:00`;
    let r; try { r = await sp.getCallInfo({ fromDateTime: fmt(from), toDateTime: fmt(now) }); }
    catch (e) { return json(200, { ok: false, error: String(e && e.message || e).slice(0, 120) }); }
    const code = String(r.err_code || '').toUpperCase();
    const rejected = r.fault || code === 'SP004' || /invalid authentication/i.test(String(r.raw || ''));
    const authed = !rejected && r.status === 200;
    return json(200, {
      ok: authed, authenticated: authed, http_status: r.status,
      servicer_acct: sp.servicer_acct,
      calls_seen: (r.calls || []).length, statuses: r.call_statuses_seen || [],
      detail: authed ? 'ServicePower authenticated as this shop' : (rejected ? 'login rejected — check the User ID / password / servicer account' : ('servicepower ' + (code || ('http ' + r.status)))),
    });
  }

  if (doo === 'claimcheck') {
    const call = String(p.call || q.call || '').trim();
    if (!call) return json(400, { ok: false, error: 'pass a call/dispatch number' });
    let r; try { r = await sp.retrieveClaims({ callNumber: call }); }
    catch (e) { return json(200, { ok: false, error: String(e && e.message || e).slice(0, 120) }); }
    return json(200, { ok: r.ok, response_code: r.response_code, transaction_id: r.transaction_id, claims: r.claims, messages: r.messages });
  }

  return json(400, { ok: false, error: 'unknown do: ' + doo });
};
