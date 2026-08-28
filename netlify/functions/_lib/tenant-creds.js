// tenant-creds — the per-tenant vendor-credential vault (Model A / BYOC) with ENVELOPE
// ENCRYPTION. Each shop has its own Data Encryption Key (DEK); the DEK encrypts that shop's
// credential blobs. The DEK itself is stored only WRAPPED by a vault master key (KEK), in
// tenant_keyring. So: the DB never holds a usable key (need the vault KEK to unwrap any DEK),
// and a single compromise exposes ONE shop, not all. All access is service-key + server-side.
// getTenantVendorCreds() is what the shared vendor libs call to run automation AS a tenant.
'use strict';
const crypto = require('crypto');
const { getSecret, getSecretPreferVault } = require('./secrets');

// ---- KEK (key-encryption key): from the vault, never the DB. Prefer a dedicated key; else
// derive one from the admin secret. Tagged so we know which KEK wrapped each DEK (rotation).
// Read the dedicated key VAULT-FIRST (getSecretPreferVault) so a key added at runtime is picked
// up immediately — getSecret caches the empty case, which would strand a just-added key. ----
async function masterKEK(want) {
  // .trim() defends against a stray space/newline on paste (same reason the vendor connectors
  // trim their creds). Harmless now (0 DEKs wrapped) and future-proofs any re-paste.
  const ded = ((await getSecretPreferVault('INTEGRATION_ENC_KEY')) || '').trim();
  if ((want === 'ded' || (!want && ded)) && ded) {
    let b = /^[0-9a-f]{64}$/i.test(ded) ? Buffer.from(ded, 'hex') : Buffer.from(ded, 'base64');
    if (b.length !== 32) b = crypto.createHash('sha256').update(ded).digest();
    return { key: b, v: 'ded' };
  }
  const ikm = (await getSecret('ADMIN_SECRET')) || 'ant-fallback-ikm';
  const key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(ikm), Buffer.from('ant-tenant-creds'), Buffer.from('v1'), 32));
  return { key, v: 'kdf1' };
}

// ---- pure AES-256-GCM primitives (operate on Buffers) ----
function gcmEnc(key, buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function gcmDec(key, b64) {
  const raw = Buffer.from(String(b64 || ''), 'base64');
  if (raw.length < 28) throw new Error('bad ciphertext');
  const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
}

async function db() {
  const base = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { base, H: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } };
}

// ---- per-tenant DEK: unwrap the shop's stored DEK, or mint + wrap + store one. Cached per
// warm container so we don't unwrap on every call. Decrypted DEKs live only in memory. ----
const _dekCache = {};
async function getDEK(companyId) {
  if (_dekCache[companyId]) return _dekCache[companyId];
  const { base, H } = await db();
  const r = await fetch(`${base}/rest/v1/tenant_keyring?company_id=eq.${companyId}&select=wrapped_dek,kek_v&limit=1`, { headers: H, signal: AbortSignal.timeout(9000) });
  const row = r.ok ? ((await r.json().catch(() => []))[0]) : null;
  if (row && row.wrapped_dek) {
    const kek = await masterKEK(row.kek_v);
    const dek = gcmDec(kek.key, row.wrapped_dek);
    _dekCache[companyId] = dek;
    return dek;
  }
  // first time for this shop: mint a fresh DEK, wrap it, store it
  const dek = crypto.randomBytes(32);
  const kek = await masterKEK(null);
  const wrapped = gcmEnc(kek.key, dek);
  await fetch(`${base}/rest/v1/tenant_keyring?on_conflict=company_id`, {
    method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ company_id: companyId, wrapped_dek: wrapped, kek_v: kek.v }), signal: AbortSignal.timeout(9000),
  });
  _dekCache[companyId] = dek;
  return dek;
}

// ---- credential encrypt/decrypt (per-tenant DEK; legacy master-key blobs still decrypt) ----
async function encryptCreds(companyId, obj) {
  const dek = await getDEK(companyId);
  return { secret_enc: gcmEnc(dek, Buffer.from(JSON.stringify(obj), 'utf8')), enc_v: 'dek1' };
}
async function decryptCreds(companyId, secret_enc, enc_v) {
  if (enc_v === 'dek1') {
    const dek = await getDEK(companyId);
    return JSON.parse(gcmDec(dek, secret_enc).toString('utf8'));
  }
  // legacy: blob was encrypted directly with the master key (pre-envelope). Back-compat only.
  const kek = await masterKEK(enc_v || 'kdf1');
  return JSON.parse(gcmDec(kek.key, secret_enc).toString('utf8'));
}

// ---- integration store (unchanged shape; encrypt now takes companyId) ----
async function storeIntegration(companyId, vendor, { label, creds, meta, status, verified_at, last_error }) {
  const { base, H } = await db();
  const enc = creds ? await encryptCreds(companyId, creds) : { secret_enc: undefined, enc_v: undefined };
  const row = {
    company_id: companyId, vendor, label: label || vendor,
    status: status || 'connected',
    verified_at: verified_at || null, last_error: last_error || null, updated_at: new Date().toISOString(),
  };
  if (meta !== undefined) row.meta = meta || {};
  if (enc.secret_enc) { row.secret_enc = enc.secret_enc; row.enc_v = enc.enc_v; }
  const r = await fetch(`${base}/rest/v1/tenant_integration?on_conflict=company_id,vendor`, {
    method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row), signal: AbortSignal.timeout(9000),
  });
  return r.ok;
}

async function listIntegrations(companyId) {
  const { base, H } = await db();
  const sel = 'vendor,label,meta,status,verified_at,last_error,updated_at';
  const r = await fetch(`${base}/rest/v1/tenant_integration?company_id=eq.${companyId}&select=${sel}&order=vendor`, { headers: H, signal: AbortSignal.timeout(9000) });
  return r.ok ? (await r.json().catch(() => [])) : [];
}

async function getTenantVendorCreds(companyId, vendor) {
  const { base, H } = await db();
  const r = await fetch(`${base}/rest/v1/tenant_integration?company_id=eq.${companyId}&vendor=eq.${vendor}&select=secret_enc,enc_v,status&limit=1`, { headers: H, signal: AbortSignal.timeout(9000) });
  const row = r.ok ? ((await r.json().catch(() => []))[0]) : null;
  if (!row || !row.secret_enc) return null;
  try { return await decryptCreds(companyId, row.secret_enc, row.enc_v); } catch (_) { return null; }
}

async function deleteIntegration(companyId, vendor) {
  const { base, H } = await db();
  const r = await fetch(`${base}/rest/v1/tenant_integration?company_id=eq.${companyId}&vendor=eq.${vendor}`, {
    method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(9000),
  });
  return r.ok;
}

module.exports = { encryptCreds, decryptCreds, storeIntegration, listIntegrations, getTenantVendorCreds, deleteIntegration };
