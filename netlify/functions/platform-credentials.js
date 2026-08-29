// platform-credentials — the shop's Credentials & Insurance vault (platform module).
// A shop uploads its COI (GL / WC / auto), license, W-9, certs; we store the file in R2 and
// index it in company_credential with an expiry. The shop can download a doc to send a
// property manager / warranty company to get approved as a vendor. Auth = the staff member's
// Supabase session (verified server-side), scoped to their own company.
//
//   POST ?do=upload    { access_token, kind, label?, expires_on?, policy_number?, notes?,
//                        file_b64, file_name, content_type }  -> { ok, id }
//   POST ?do=list      { access_token }                       -> { ok, items:[...] }
//   POST ?do=download  { access_token, id }                   -> { ok, url }  (10-min signed)
//   POST ?do=delete    { access_token, id }                   -> { ok }
'use strict';

const crypto = require('crypto');
const { getSecret } = require('./_lib/secrets');
const r2 = require('./_lib/r2');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

const KINDS = new Set(['coi_gl', 'coi_wc', 'coi_auto', 'license', 'w9', 'cert', 'other']);

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url: String(url).replace(/\/+$/, ''), key };
}
function rest(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) { const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(8000) }); return r.ok ? r.json() : []; },
    async insert(table, row) { const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) }); const d = await r.json().catch(() => null); if (!r.ok) throw new Error((d && (d.message || d.hint)) || ('insert ' + r.status)); return Array.isArray(d) ? d[0] : d; },
    async del(path) { const r = await fetch(`${base}/rest/v1/${path}`, { method: 'DELETE', headers: H, signal: AbortSignal.timeout(8000) }); return r.ok; },
  };
}
async function authCompany(base, key, token) {
  if (!token) return null;
  let u = null;
  try { const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) }); if (r.ok) u = await r.json(); } catch (_) {}
  if (!u || !u.id) return null;
  const db = rest(base, key);
  const us = await db.get(`app_user?auth_user_id=eq.${u.id}&select=company_id&limit=1`);
  return (us && us[0] && us[0].company_id) || null;
}
function safeName(n) { return String(n || 'file').replace(/[^\w.\-]+/g, '_').slice(-80) || 'file'; }
function nullDate(d) { d = String(d || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  let p = {}; try { p = JSON.parse(event.body || '{}'); } catch (_) {}
  const doo = String(q.do || p.do || '');

  const { url, key } = await cfg();
  if (!url || !key) return json(200, { ok: false, error: 'platform_not_configured' });
  const db = rest(url, key);
  const companyId = await authCompany(url, key, String(p.access_token || '').trim());
  if (!companyId) return json(200, { ok: false, error: 'not_signed_in' });

  try {
    if (doo === 'list') {
      const items = await db.get(`company_credential?company_id=eq.${companyId}&select=id,kind,label,file_name,issued_on,expires_on,policy_number,created_at&order=created_at.desc`);
      return json(200, { ok: true, items: items || [] });
    }

    if (doo === 'upload') {
      const kind = String(p.kind || '').trim();
      if (!KINDS.has(kind)) return json(200, { ok: false, error: 'bad kind' });
      const b64 = String(p.file_b64 || '').replace(/^data:[^;]*;base64,/, '');
      if (!b64) return json(200, { ok: false, error: 'no file' });
      let buf; try { buf = Buffer.from(b64, 'base64'); } catch (_) { buf = null; }
      if (!buf || !buf.length) return json(200, { ok: false, error: 'bad file' });
      if (buf.length > 8 * 1024 * 1024) return json(200, { ok: false, error: 'file too big (8MB max)' });
      if (!(await r2.isConfigured())) return json(200, { ok: false, error: 'storage_not_configured' });
      const path = `${companyId}/credentials/${crypto.randomUUID()}__${safeName(p.file_name)}`;
      await r2.put(path, buf, String(p.content_type || 'application/octet-stream'));
      const row = await db.insert('company_credential', {
        company_id: companyId, kind, label: String(p.label || '').trim() || null,
        storage_path: path, file_name: safeName(p.file_name),
        issued_on: nullDate(p.issued_on), expires_on: nullDate(p.expires_on),
        policy_number: String(p.policy_number || '').trim() || null,
        notes: String(p.notes || '').trim() || null,
      });
      return json(200, { ok: true, id: row && row.id });
    }

    if (doo === 'download') {
      const id = String(p.id || '').trim();
      const rows = await db.get(`company_credential?id=eq.${id}&company_id=eq.${companyId}&select=storage_path&limit=1`);
      const row = rows && rows[0];
      if (!row || !row.storage_path) return json(200, { ok: false, error: 'not found' });
      const url2 = await r2.presignGet(row.storage_path, 600);
      return json(200, { ok: true, url: url2 });
    }

    if (doo === 'delete') {
      const id = String(p.id || '').trim();
      const rows = await db.get(`company_credential?id=eq.${id}&company_id=eq.${companyId}&select=id,storage_path&limit=1`);
      const row = rows && rows[0];
      if (!row) return json(200, { ok: false, error: 'not found' });
      if (row.storage_path) { try { await r2.del(row.storage_path); } catch (_) {} }
      await db.del(`company_credential?id=eq.${id}&company_id=eq.${companyId}`);
      return json(200, { ok: true });
    }

    return json(200, { ok: false, error: 'unknown do' });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
