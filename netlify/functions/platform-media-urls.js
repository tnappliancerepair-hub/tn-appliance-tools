// platform-media-urls — batch signer for R2-stored media. Returns short-lived signed GET
// URLs for a list of object keys, but ONLY the caller's own tenant's objects. Two auth
// modes: staff pass Authorization: Bearer <supabase jwt>; customers pass ?t=<portal token>.
// Each key is company_id/… so the tenant check is a folder-prefix match.
//   POST ?t=<token>? {refs:[...]}  (Bearer header for staff)  -> { urls: { ref: signedUrl } }
'use strict';
const { getSecret } = require('./_lib/secrets');
const r2 = require('./_lib/r2');
const PLATFORM_ANON = 'sb_publishable_gtcSGgZWhqkrUxdPxFhKrA_CwUBcyq7';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }

// Resolve the caller's company_id from either a Supabase session (staff) or a portal token.
async function callerCompany(event, q) {
  const base = (await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  const H = { apikey: key, Authorization: 'Bearer ' + key };
  // customer: portal token
  if (q.t) {
    try {
      const r = await fetch(`${base}/rest/v1/portal_grant?token=eq.${encodeURIComponent(q.t)}&select=company_id,revoked,expires_at&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) });
      const g = ((await r.json().catch(() => [])) || [])[0];
      if (g && !g.revoked && (!g.expires_at || Date.parse(g.expires_at) > Date.now())) return g.company_id;
    } catch (_) {}
    return null;
  }
  // staff: bearer jwt -> auth user -> app_user.company_id
  const m = String((event.headers || {}).authorization || (event.headers || {}).Authorization || '').match(/Bearer\s+(.+)/i);
  if (!m) return null;
  try {
    const ur = await fetch(`${base}/auth/v1/user`, { headers: { Authorization: 'Bearer ' + m[1], apikey: PLATFORM_ANON }, signal: AbortSignal.timeout(8000) });
    if (!ur.ok) return null;
    const u = await ur.json().catch(() => null);
    if (!u || !u.id) return null;
    const ar = await fetch(`${base}/rest/v1/app_user?auth_user_id=eq.${u.id}&select=company_id&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) });
    const a = ((await ar.json().catch(() => [])) || [])[0];
    return a ? a.company_id : null;
  } catch (_) { return null; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const refs = Array.isArray(body.refs) ? body.refs.slice(0, 60).map(String) : [];
  if (!refs.length) return json(200, { ok: true, urls: {} });

  const company = await callerCompany(event, q);
  if (!company) return json(403, { ok: false, error: 'forbidden' });

  const urls = {};
  for (const ref of refs) {
    if (String(ref).split('/')[0] !== company) continue; // tenant check
    try { urls[ref] = await r2.presignGet(ref, 3600); } catch (_) {}
  }
  return json(200, { ok: true, urls });
};
