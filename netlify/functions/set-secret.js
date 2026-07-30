// Stores a secret into the Xano `app_config` vault (used by getSecret). Gated
// by the office password so only the office can write secrets. Upserts by name.
//
// POST { password, name, value }  ->  { ok }
//
// One-time setup: create a table named `app_config` in Xano with two text
// columns `name` and `value` (no API endpoints on it — Metadata-API only).

'use strict';

const SITE = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://tnapplianceexchange.net';
const XANO_META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const { configTableId, getSecret } = require('./_lib/secrets');

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function jsonResp(code, body) { return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (_) { return jsonResp(400, { ok: false, error: 'invalid_json' }); }

  const pin = String(b.pin || '');
  const name = String(b.name || '').trim();
  const value = String(b.value || '');
  if (!name || !value) return jsonResp(400, { ok: false, error: 'name and value required' });

  // OWNER-ONLY gate: Teddy's tech PIN (technician_id 1) OR the admin secret
  // (same owner-level trust boundary — lets Claude/tools set vault keys). The
  // office password is intentionally NOT accepted here.
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let authorized = String(b.secret || '') === admin;
  if (!authorized) {
    try {
      const vr = await fetch(`${SITE}/.netlify/functions/verify-pin-proxy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ technician_id: 1, pin }),
      });
      const vd = await vr.json();
      if (!vd || !vd.success) return jsonResp(401, { ok: false, error: 'owner_pin_or_secret_required' });
    } catch (_) { return jsonResp(502, { ok: false, error: 'auth_unavailable' }); }
  }

  try {
    const tid = await configTableId(); // throws a clear message if table missing
    // upsert by name
    const sr = await fetch(`${XANO_META}/table/${tid}/content/search`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ search: { name }, per_page: 5, page: 1 }),
    });
    const sd = sr.ok ? await sr.json() : { items: [] };
    const existing = ((sd && sd.items) || []).find((x) => x && x.name === name);
    if (existing) {
      const ur = await fetch(`${XANO_META}/table/${tid}/content/${existing.id}`, {
        method: 'PUT', headers: headers(), body: JSON.stringify({ name, value }),
      });
      if (!ur.ok) return jsonResp(502, { ok: false, error: 'update_failed ' + ur.status });
    } else {
      const ir = await fetch(`${XANO_META}/table/${tid}/content`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ name, value }),
      });
      if (!ir.ok) return jsonResp(502, { ok: false, error: 'insert_failed ' + ir.status });
    }
    return jsonResp(200, { ok: true, name, stored: true });
  } catch (err) {
    return jsonResp(200, { ok: false, error: err.message });
  }
};
