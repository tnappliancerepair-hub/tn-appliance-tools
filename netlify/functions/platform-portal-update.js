// platform-portal-update — the customer verifies/adjusts their OWN contact + service address
// from the portal. Token-gated (the portal_grant), so no login: we resolve the grant to the
// company + customer with the service key, then update ONLY that customer's row. This is the
// "wrong house" fix — a customer with multiple houses corrects the service address before we
// roll a truck. Logs the change to the shared thread so the office sees it.
//   POST ?t=<portal token>  { phone?, address?, city?, state?, zip? }  -> { ok, saved:[...] }
'use strict';
const { getSecret } = require('./_lib/secrets');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function clean(v, n) { return String(v == null ? '' : v).trim().slice(0, n || 120); }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const token = clean(q.t || body.t, 80);
  if (!token) return json(200, { ok: false, error: 'no_token' });

  const base = String((await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!key) return json(200, { ok: false, error: 'platform_not_configured' });
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

  // Resolve the portal_grant → company + customer (+ job for the thread note). Token only.
  let grant;
  try {
    const r = await fetch(`${base}/rest/v1/portal_grant?token=eq.${encodeURIComponent(token)}&select=company_id,customer_id,job_id,revoked,expires_at&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) });
    grant = ((await r.json().catch(() => [])) || [])[0];
  } catch (_) {}
  if (!grant || grant.revoked || (grant.expires_at && Date.parse(grant.expires_at) < Date.now())) return json(200, { ok: false, error: 'link_expired' });
  const companyId = grant.company_id, customerId = grant.customer_id;
  if (!companyId || !customerId) return json(200, { ok: false, error: 'no_customer' });

  // Build the patch from only the fields the customer actually provided (never blank a field).
  const map = { phone: 40, address: 160, city: 80, state: 30, zip: 16 };
  const patch = {};
  for (const f in map) { if (Object.prototype.hasOwnProperty.call(body, f)) { const v = clean(body[f], map[f]); if (v) patch[f] = v; } }
  const saved = Object.keys(patch);
  if (!saved.length) return json(200, { ok: false, error: 'nothing_to_save' });

  try {
    const up = await fetch(`${base}/rest/v1/customer?id=eq.${customerId}&company_id=eq.${companyId}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(patch), signal: AbortSignal.timeout(8000) });
    if (!up.ok) return json(200, { ok: false, error: 'save_failed' });
  } catch (_) { return json(200, { ok: false, error: 'save_failed' }); }

  // Tell the office on the shared thread so a wrong-address correction can't be missed.
  try {
    const addrBits = [patch.address, patch.city, patch.state, patch.zip].filter(Boolean).join(', ');
    const noteBits = [];
    if (patch.phone) noteBits.push('phone → ' + patch.phone);
    if (addrBits) noteBits.push('service address → ' + addrBits);
    await fetch(`${base}/rest/v1/thread_message`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ company_id: companyId, customer_id: customerId, job_id: grant.job_id || null, direction: 'in', channel: 'portal', sender: 'customer', body: '✏️ Customer verified their info' + (noteBits.length ? ': ' + noteBits.join(' · ') : '') }), signal: AbortSignal.timeout(8000) });
  } catch (_) {}

  return json(200, { ok: true, saved });
};
