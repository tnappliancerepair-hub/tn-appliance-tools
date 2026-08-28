// r2.js — Cloudflare R2 (S3-compatible) client, dependency-free SigV4. Photos/files live
// here (zero egress). Config from the vault: R2_ENDPOINT (https://<acct>.r2.cloudflarestorage.com),
// R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY. Path-style, region "auto".
//   presignGet(key, sec) -> a signed GET url (serving); put(key, buf, type); del(key); isConfigured()
'use strict';
const crypto = require('crypto');
const { getSecret } = require('./secrets');

const REGION = 'auto', SERVICE = 's3';
let _cfg = null;
async function cfg() {
  if (_cfg) return _cfg;
  const endpoint = (await getSecret('R2_ENDPOINT') || '').replace(/\/+$/, '');
  _cfg = {
    endpoint,
    host: endpoint ? new URL(endpoint).host : '',
    bucket: (await getSecret('R2_BUCKET')) || 'ant-media',
    ak: await getSecret('R2_ACCESS_KEY_ID'),
    sk: await getSecret('R2_SECRET_ACCESS_KEY'),
  };
  return _cfg;
}
async function isConfigured() { const c = await cfg(); return !!(c.endpoint && c.ak && c.sk); }

const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
function amzDates() { const d = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); return { amz: d, day: d.slice(0, 8) }; }
function enc(str, slash) { // RFC3986 URI-encode; slash=false keeps '/'
  return String(str).split('/').map(function (seg) {
    return encodeURIComponent(seg).replace(/[!'()*]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
  }).join(slash ? '%2F' : '/');
}
function signingKey(sk, day) { return hmac(hmac(hmac(hmac('AWS4' + sk, day), REGION), SERVICE), 'aws4_request'); }

// Presigned GET (query-string auth) — a self-contained URL good for `sec` seconds.
async function presignGet(key, sec) {
  const c = await cfg(); if (!c.endpoint) throw new Error('r2 not configured');
  const { amz, day } = amzDates();
  const scope = `${day}/${REGION}/${SERVICE}/aws4_request`;
  const uri = `/${c.bucket}/${enc(key)}`;
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${c.ak}/${scope}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(sec || 600),
    'X-Amz-SignedHeaders': 'host',
  };
  const cq = Object.keys(params).sort().map(function (k) { return enc(k, 1) + '=' + enc(params[k], 1); }).join('&');
  const canonical = `GET\n${uri}\n${cq}\nhost:${c.host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const sts = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${sha256hex(canonical)}`;
  const sig = hmac(signingKey(c.sk, day), sts).toString('hex');
  return `${c.endpoint}${uri}?${cq}&X-Amz-Signature=${sig}`;
}

// Server-side PUT (Authorization header) — upload bytes we already hold.
async function put(key, body, contentType) {
  const c = await cfg(); if (!c.endpoint) throw new Error('r2 not configured');
  const { amz, day } = amzDates();
  const scope = `${day}/${REGION}/${SERVICE}/aws4_request`;
  const uri = `/${c.bucket}/${enc(key)}`;
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const payloadHash = sha256hex(buf);
  const ct = contentType || 'application/octet-stream';
  const headers = { host: c.host, 'content-type': ct, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amz };
  const signed = Object.keys(headers).sort();
  const canonicalHeaders = signed.map(function (h) { return h + ':' + headers[h] + '\n'; }).join('');
  const signedHeaders = signed.join(';');
  const canonical = `PUT\n${uri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const sts = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${sha256hex(canonical)}`;
  const sig = hmac(signingKey(c.sk, day), sts).toString('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${c.ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;
  const r = await fetch(`${c.endpoint}${uri}`, { method: 'PUT', headers: { 'Content-Type': ct, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amz, Authorization: auth }, body: buf, signal: AbortSignal.timeout(20000) });
  return r.ok ? true : Promise.reject(new Error('r2 put ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120)));
}

async function del(key) {
  const c = await cfg(); if (!c.endpoint) return false;
  const { amz, day } = amzDates();
  const scope = `${day}/${REGION}/${SERVICE}/aws4_request`;
  const uri = `/${c.bucket}/${enc(key)}`;
  const payloadHash = sha256hex('');
  const headers = { host: c.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amz };
  const signed = Object.keys(headers).sort();
  const canonicalHeaders = signed.map(function (h) { return h + ':' + headers[h] + '\n'; }).join('');
  const signedHeaders = signed.join(';');
  const canonical = `DELETE\n${uri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const sts = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${sha256hex(canonical)}`;
  const sig = hmac(signingKey(c.sk, day), sts).toString('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${c.ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;
  try { const r = await fetch(`${c.endpoint}${uri}`, { method: 'DELETE', headers: { 'x-amz-content-sha256': payloadHash, 'x-amz-date': amz, Authorization: auth }, signal: AbortSignal.timeout(12000) }); return r.ok; } catch (_) { return false; }
}

module.exports = { presignGet, put, del, isConfigured };
