// vendor-docs — the compliance-packet backend for the Vendor Compliance Center.
//   GET ?meta=1                      -> { ok, coi_expires, w9, license, coi } (what's available)
//   GET ?doc=w9|license|coi          -> 302 to a signed S3 download of that PDF
//   POST {action:'request', ...}     -> a PM requests a COI / the packet -> texts Teddy + logs
//   POST {action:'set', secret, ...} -> ADMIN: record the uploaded doc S3 keys + COI expiry
//
// Doc keys + expiry live in a single latest-wins event_log `vendor_docs_config` row, set by
// the admin upload page (vendor-docs-admin.html). PDFs live in S3; downloads are signed URLs.
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const OWNER = '+16154855795';
const DANIELLE = '+16154850713';
const DOC_LABELS = { w9: 'TN-Appliance-Exchange-W9', license: 'TN-Appliance-Exchange-Business-License', coi: 'TN-Appliance-Exchange-Certificate-of-Insurance' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
exports.config = { timeout: 26 };
const s = (v, n) => String(v == null ? '' : v).slice(0, n == null ? 200 : n).trim();
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });

async function loadConfig() {
  try {
    const row = await crud.searchOne(crud.TABLES.event_log, { action: 'vendor_docs_config' }, { id: 'desc' });
    let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    return m || {};
  } catch (_) { return {}; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};

  // ── serve a signed PDF download ──
  if (q.doc) {
    const doc = String(q.doc).toLowerCase();
    if (!DOC_LABELS[doc]) return json(400, { ok: false, error: 'unknown doc' });
    const cfg = await loadConfig();
    const key = cfg[doc + '_key'];
    if (!key) return json(404, { ok: false, error: doc + ' not uploaded yet' });
    try {
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.TN_AWS_S3_BUCKET, Key: key, ResponseContentType: 'application/pdf', ResponseContentDisposition: 'attachment; filename="' + DOC_LABELS[doc] + '.pdf"' }), { expiresIn: 900 });
      return { statusCode: 302, headers: { Location: url, 'cache-control': 'no-store' }, body: '' };
    } catch (e) { return json(500, { ok: false, error: 'sign failed' }); }
  }

  // ── what's available (for the page to render) ──
  if (q.meta) {
    const cfg = await loadConfig();
    return json(200, { ok: true, coi_expires: cfg.coi_expires || '', w9: !!cfg.w9_key, license: !!cfg.license_key, coi: !!cfg.coi_key });
  }

  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'invalid_json' }); }
  const action = s(b.action, 30);

  // ── ADMIN: record uploaded doc keys + COI expiry ──
  if (action === 'set') {
    const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (s(b.secret, 80) !== admin) return json(401, { ok: false, error: 'unauthorized' });
    const cur = await loadConfig();
    const next = Object.assign({}, cur);
    if (b.w9_key) next.w9_key = s(b.w9_key, 300);
    if (b.license_key) next.license_key = s(b.license_key, 300);
    if (b.coi_key) next.coi_key = s(b.coi_key, 300);
    if (b.coi_expires !== undefined) next.coi_expires = s(b.coi_expires, 20);
    next.at_ms = Date.now();
    try { await crud.logEvent('vendor_docs_config', next); } catch (e) { return json(500, { ok: false, error: 'save failed' }); }
    return json(200, { ok: true, config: { w9: !!next.w9_key, license: !!next.license_key, coi: !!next.coi_key, coi_expires: next.coi_expires || '' } });
  }

  // ── a PM requests a COI (named as additional insured) or the packet ──
  if (action === 'request') {
    const company = s(b.company, 120), contact = s(b.contact, 80), email = s(b.email, 120), phone = s(b.phone, 40);
    const certHolder = s(b.cert_holder, 160), certAddr = s(b.cert_address, 240), coverage = s(b.coverage, 200), notes = s(b.notes, 500);
    const kind = s(b.kind, 30) || 'coi';
    if (!company && !contact && !email && !phone) return json(400, { ok: false, error: 'tell us who you are' });
    await crud.logEvent('vendor_' + (kind === 'packet' ? 'packet' : 'coi') + '_request', { company, contact, email, phone, cert_holder: certHolder, cert_address: certAddr, coverage, notes, at_ms: Date.now() });
    const alert = '[ant] 📄 ' + (kind === 'packet' ? 'VENDOR PACKET' : 'COI') + ' request from ' + (company || contact || email || phone) +
      (certHolder ? ('\nName as additional insured: ' + certHolder) : '') + (certAddr ? ('\n' + certAddr) : '') +
      (coverage ? ('\nCoverage: ' + coverage) : '') + '\nContact: ' + (contact || '') + ' ' + (phone || '') + (email ? (' · ' + email) : '') +
      (notes ? ('\n"' + notes + '"') : '') + '\n→ pull the cert from Hiscox/Hartford/Progressive and send it.';
    try { await sendSms(OWNER, alert, 'owner', 'vendor_doc_request'); } catch (_) {}
    try { await sendSms(DANIELLE, alert, 'warranty_handler', 'vendor_doc_request'); } catch (_) {}
    return json(200, { ok: true });
  }

  return json(400, { ok: false, error: 'unknown action' });
};
