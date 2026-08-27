// platform-tech-media — a TECH adds his OWN photos + videos to a job (the shots he takes
// on site, separate from the customer's intake bundle). Same hosting as intake: photos in
// Supabase Storage, video on Cloudflare Stream. Auth is the tech's Supabase session token,
// verified server-side; writes go through the platform service key and are scoped to the
// tech's own shop + the job he's on. Media lands in job_media tagged "Tech photo/video".
//
//   POST ?do=photo         { job, access_token, data(base64 dataURL), label? } -> { ok, url }
//   POST ?do=stream_mint   { job, access_token, bytes, filename }  -> { ok, uploadUrl, uid }
//   POST ?do=stream_done   { job, access_token, uid, label? }      -> { ok }
//   POST ?do=delete_media  { job, access_token, id }               -> { ok }
'use strict';

const { getSecret } = require('./_lib/secrets');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function b64(str) { return Buffer.from(String(str), 'utf8').toString('base64'); }

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url: String(url).replace(/\/+$/, ''), key };
}
function rest(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) { const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(8000) }); return r.ok ? r.json() : []; },
    async insert(table, row) { const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) }); return r.ok; },
    async storagePut(bucket, path, buf, contentType) {
      const r = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': contentType, 'x-upsert': 'true' }, body: buf, signal: AbortSignal.timeout(15000) });
      return r.ok;
    },
    async del(path) { const r = await fetch(`${base}/rest/v1/${path}`, { method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(8000) }); return r.ok; },
    async storageDelete(bucket, objPath) { try { await fetch(`${base}/storage/v1/object/${bucket}/${objPath}`, { method: 'DELETE', headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(8000) }); } catch (_) {} },
  };
}

// Verify the tech's session token -> the auth user id (Supabase /auth/v1/user).
async function authUser(base, key, accessToken) {
  if (!accessToken) return null;
  try {
    const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: 'Bearer ' + accessToken }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) ? u : null;
  } catch (_) { return null; }
}

// Resolve the caller to a job they may touch: their app_user -> company_id, then confirm the
// job is in that company. Returns { company_id } or null. Service-key reads, session-verified.
async function scopeToJob(db, authId, jobId) {
  if (!authId || !jobId) return null;
  const us = await db.get(`app_user?auth_user_id=eq.${authId}&select=company_id&limit=1`);
  const companyId = us && us[0] && us[0].company_id;
  if (!companyId) return null;
  const js = await db.get(`job?id=eq.${jobId}&select=id&company_id=eq.${companyId}&limit=1`);
  if (!js || !js[0]) return null;
  return { company_id: companyId };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const p = Object.assign({}, body, q);
  const doo = String(q.do || p.do || '');
  const jobId = String(p.job || '').trim();
  const token = String(p.access_token || '').trim();

  const { url, key } = await cfg();
  if (!url || !key) return json(200, { ok: false, error: 'platform_not_configured' });
  const db = rest(url, key);

  const u = await authUser(url, key, token);
  if (!u) return json(200, { ok: false, error: 'not_signed_in' });
  const scope = await scopeToJob(db, u.id, jobId);
  if (!scope) return json(200, { ok: false, error: 'not_your_job' });

  try {
    if (doo === 'photo') {
      const data = String(p.data || '');
      const m = data.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
      if (!m) return json(400, { ok: false, error: 'bad image' });
      const contentType = m[1];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 6 * 1024 * 1024) return json(400, { ok: false, error: 'image too large' });
      const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
      const path = `${scope.company_id}/${jobId}/tech-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
      const ok = await db.storagePut('intake-photos', path, buf, contentType);
      if (!ok) return json(200, { ok: false, error: 'upload_failed' });
      await db.insert('job_media', { company_id: scope.company_id, job_id: jobId, kind: 'photo', provider: 'storage', ref: path, label: String(p.label || 'Tech photo').slice(0, 80) });
      return json(200, { ok: true, url: `${url}/storage/v1/object/public/intake-photos/${path}` });
    }

    if (doo === 'stream_mint') {
      const acct = await getSecret('CLOUDFLARE_ACCOUNT_ID');
      const ctok = await getSecret('CLOUDFLARE_STREAM_TOKEN');
      if (!acct || !ctok) return json(200, { ok: false, error: 'video_not_configured' });
      const bytes = parseInt(p.bytes, 10);
      if (!bytes || bytes < 1) return json(400, { ok: false, error: 'bytes required' });
      const meta = ['name ' + b64(String(p.filename || 'tech.mp4').slice(0, 100)), 'maxDurationSeconds ' + b64('600')].join(',');
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/stream?direct_user=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctok}`, 'Tus-Resumable': '1.0.0', 'Upload-Length': String(bytes), 'Upload-Metadata': meta },
      });
      const uid = r.headers.get('stream-media-id') || '';
      const uploadUrl = r.headers.get('location') || '';
      if (!uploadUrl) { let d = ''; try { d = await r.text(); } catch (_) {} return json(200, { ok: false, error: 'cf_no_location', status: r.status, detail: d.slice(0, 200) }); }
      return json(200, { ok: true, uploadUrl, uid });
    }

    if (doo === 'stream_done') {
      const uid = String(p.uid || '').trim().slice(0, 120);
      if (!uid) return json(400, { ok: false, error: 'uid required' });
      await db.insert('job_media', { company_id: scope.company_id, job_id: jobId, kind: 'video', provider: 'cfstream', ref: uid, label: String(p.label || 'Tech video').slice(0, 80) });
      return json(200, { ok: true });
    }

    if (doo === 'delete_media') {
      const id = String(p.id || '').trim();
      if (!id) return json(400, { ok: false, error: 'id required' });
      const rows = await db.get(`job_media?id=eq.${id}&job_id=eq.${jobId}&company_id=eq.${scope.company_id}&select=id,provider,ref&limit=1`);
      const row = rows && rows[0];
      if (!row) return json(200, { ok: false, error: 'not_found' });
      // best-effort remove the underlying asset, then the row
      if (row.provider === 'storage' && row.ref) { await db.storageDelete('intake-photos', row.ref); }
      if (row.provider === 'cfstream' && row.ref) {
        try {
          const acct = await getSecret('CLOUDFLARE_ACCOUNT_ID');
          const ctok = await getSecret('CLOUDFLARE_STREAM_TOKEN');
          if (acct && ctok) await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/stream/${encodeURIComponent(row.ref)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ctok}` }, signal: AbortSignal.timeout(8000) });
        } catch (_) {}
      }
      const ok = await db.del(`job_media?id=eq.${id}&company_id=eq.${scope.company_id}`);
      return json(200, { ok });
    }

    return json(200, { ok: false, error: 'unknown do' });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
