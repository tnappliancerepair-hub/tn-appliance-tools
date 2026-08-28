// tenant-creds — the per-tenant vendor-credential vault (Model A / BYOC). Each shop's own
// AHS/ServicePower/Marcone/... login is stored ONLY as AES-256-GCM ciphertext in the ANT
// Platforms tenant_integration table; the encryption key lives in OUR vault, never in that DB,
// so a DB compromise yields nothing usable. All access here is service-key + server-side only:
// the browser never sees a stored secret back. getTenantVendorCreds() is what the shared vendor
// libs call to run automation AS a given tenant.
'use strict';
const crypto = require('crypto');
const { getSecret } = require('./secrets');

// Encryption key: prefer a dedicated vault key; else derive one from a stable server-only
// secret via HKDF. The row is tagged with which was used (enc_v) so we can rotate/migrate.
async function keyFor(encV) {
  const ded = (await getSecret('INTEGRATION_ENC_KEY')) || '';
  if ((encV === 'ded' || (!encV && ded)) && ded) {
    // accept 64-hex or base64; normalize to 32 bytes
    let b = /^[0-9a-f]{64}$/i.test(ded) ? Buffer.from(ded, 'hex') : Buffer.from(ded, 'base64');
    if (b.length !== 32) b = crypto.createHash('sha256').update(ded).digest();
    return { key: b, v: 'ded' };
  }
  const ikm = (await getSecret('ADMIN_SECRET')) || 'ant-fallback-ikm';
  const key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(ikm), Buffer.from('ant-tenant-creds'), Buffer.from('v1'), 32));
  return { key, v: 'kdf1' };
}

async function encryptCreds(obj) {
  const { key, v } = await keyFor(null);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return { secret_enc: Buffer.concat([iv, tag, ct]).toString('base64'), enc_v: v };
}
async function decryptCreds(secret_enc, enc_v) {
  const raw = Buffer.from(String(secret_enc || ''), 'base64');
  if (raw.length < 28) throw new Error('bad ciphertext');
  const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), ct = raw.subarray(28);
  const { key } = await keyFor(enc_v || 'kdf1');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
}

async function db() {
  const base = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { base, H: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } };
}

// Upsert an integration for a tenant. `creds` is encrypted here; `meta` must be NON-secret.
async function storeIntegration(companyId, vendor, { label, creds, meta, status, verified_at, last_error }) {
  const { base, H } = await db();
  const enc = creds ? await encryptCreds(creds) : { secret_enc: undefined, enc_v: undefined };
  const row = {
    company_id: companyId, vendor, label: label || vendor,
    status: status || 'connected',
    verified_at: verified_at || null, last_error: last_error || null, updated_at: new Date().toISOString(),
  };
  if (meta !== undefined) row.meta = meta || {};          // only touch meta when provided
  if (enc.secret_enc) { row.secret_enc = enc.secret_enc; row.enc_v = enc.enc_v; }  // only re-store creds when given
  const r = await fetch(`${base}/rest/v1/tenant_integration?on_conflict=company_id,vendor`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row), signal: AbortSignal.timeout(9000),
  });
  return r.ok;
}

// Safe status list for the tenant UI — NEVER includes secret_enc/enc_v.
async function listIntegrations(companyId) {
  const { base, H } = await db();
  const sel = 'vendor,label,meta,status,verified_at,last_error,updated_at';
  const r = await fetch(`${base}/rest/v1/tenant_integration?company_id=eq.${companyId}&select=${sel}&order=vendor`, { headers: H, signal: AbortSignal.timeout(9000) });
  return r.ok ? (await r.json().catch(() => [])) : [];
}

// Server-side ONLY: decrypt a tenant's vendor creds so a shared connector can run as them.
async function getTenantVendorCreds(companyId, vendor) {
  const { base, H } = await db();
  const r = await fetch(`${base}/rest/v1/tenant_integration?company_id=eq.${companyId}&vendor=eq.${vendor}&select=secret_enc,enc_v,status&limit=1`, { headers: H, signal: AbortSignal.timeout(9000) });
  const row = r.ok ? ((await r.json().catch(() => []))[0]) : null;
  if (!row || !row.secret_enc) return null;
  try { return await decryptCreds(row.secret_enc, row.enc_v); } catch (_) { return null; }
}

async function deleteIntegration(companyId, vendor) {
  const { base, H } = await db();
  const r = await fetch(`${base}/rest/v1/tenant_integration?company_id=eq.${companyId}&vendor=eq.${vendor}`, {
    method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(9000),
  });
  return r.ok;
}

module.exports = { encryptCreds, decryptCreds, storeIntegration, listIntegrations, getTenantVendorCreds, deleteIntegration };
