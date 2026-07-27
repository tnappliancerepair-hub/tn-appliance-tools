// return-label-find — snap a photo of a part box → get its prepaid return label to print.
// The whole return grind (150 parts) comes down to "which label goes with this box?".
// This reads the box with Claude Vision (claim # + customer + part), searches Gmail LIVE
// for the SquareTrade/Allstate RMA email (works even for boxes we never captured), pulls
// the prepaid label PDF, hosts it printable, and hands back a tap-to-print link + the
// Gmail deep-link. Owner-gated.
//   POST { image_b64, secret }  ->  { ok, ocr, labels:[{rma, subject, pdf_url, gmail_link}] }
'use strict';
const { getSecret } = require('./_lib/secrets');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }
const MODEL = 'claude-sonnet-5';
const OCR_PROMPT = `You are reading a photo of a shipping box for an appliance part that is being RETURNED under a warranty (SquareTrade / Allstate). There may be a FedEx label and other stickers. Extract what you can. Return STRICT JSON only, this shape:
{"claim_number":"<the Allstate/SquareTrade claim or dispatch number, usually 10-12 digits — the MOST important field>","customer_name":"<recipient name>","part_number":"<the appliance part number if shown>","rma_number":"<RMA/REF number if shown>","distributor":"<Marcone/Encompass/Reliable/UED/etc if shown>","tracking_number":"<the FedEx tracking number if shown>"}
Use "" for anything not visible. Do not guess the claim number — only report digits you can actually read.`;

async function gmailClient() {
  const id = process.env.GMAIL_CLIENT_ID, secret = process.env.GMAIL_CLIENT_SECRET, refresh = process.env.GMAIL_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  try { const { google } = require('googleapis'); const o = new google.auth.OAuth2(id, secret); o.setCredentials({ refresh_token: refresh }); return google.gmail({ version: 'v1', auth: o }); } catch (_) { return null; }
}
// Pull the first PDF attachment out of a message.
async function pdfFromMessage(gmail, id) {
  try {
    const full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const subject = ((full.data.payload.headers || []).find((h) => h.name.toLowerCase() === 'subject') || {}).value || '';
    const found = [];
    (function walk(p) { if (!p) return; const mt = (p.mimeType || '').toLowerCase(); const fn = p.filename || ''; if ((mt === 'application/pdf' || /\.pdf$/i.test(fn)) && p.body && p.body.attachmentId) found.push({ filename: fn || 'return-label.pdf', attachmentId: p.body.attachmentId }); if (p.parts) p.parts.forEach(walk); })(full.data.payload);
    if (!found.length) return { subject, pdf: null };
    const att = await gmail.users.messages.attachments.get({ userId: 'me', messageId: id, id: found[0].attachmentId });
    const b64 = String((att.data && att.data.data) || '').replace(/-/g, '+').replace(/_/g, '/');
    return { subject, pdf: b64 ? Buffer.from(b64, 'base64') : null, filename: found[0].filename };
  } catch (_) { return { subject: '', pdf: null }; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  let imgB64 = String(b.image_b64 || ''); let mediaType = b.media_type || 'image/jpeg';
  const m = /^data:([^;]+);base64,(.*)$/i.exec(imgB64); if (m) { mediaType = m[1]; imgB64 = m[2]; }
  if (!imgB64) return json(400, { ok: false, error: 'image_b64 required' });

  // 1) OCR the box.
  let ocr = {};
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: imgB64 } }, { type: 'text', text: OCR_PROMPT }] }] }) });
    const d = await r.json();
    if (!r.ok || !d.content) throw new Error(JSON.stringify(d).slice(0, 160));
    ocr = JSON.parse(String(d.content[0].text || '').replace(/```json|```/g, '').trim());
  } catch (e) { return json(502, { ok: false, error: 'could not read the box: ' + String(e.message || e) }); }

  const claim = String(ocr.claim_number || '').replace(/[^0-9]/g, '');
  const cust = String(ocr.customer_name || '').trim();
  const gmail = await gmailClient();
  if (!gmail) return json(200, { ok: true, ocr, labels: [], note: 'Gmail is not connected — cannot pull the label.' });

  // 2) Find the RMA label email(s) — claim # first, then customer name.
  const queries = [];
  if (claim) queries.push(`from:rma_request@squaretrade.com ${claim}`);
  if (cust) queries.push(`from:rma_request@squaretrade.com ${cust.split(/\s+/).slice(-1)[0]}`); // last name
  if (claim) queries.push(`${claim} has:attachment`);
  let msgs = [];
  for (const q of queries) {
    try { const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: 8 }); if (list.data.messages && list.data.messages.length) { msgs = list.data.messages; break; } } catch (_) {}
  }
  if (!msgs.length) {
    const gl = claim ? `https://mail.google.com/mail/u/0/#search/${encodeURIComponent('from:rma_request@squaretrade.com ' + claim)}` : '';
    return json(200, { ok: true, ocr, labels: [], gmail_search: gl, note: 'No RMA label email found for this box yet — it may not have been issued. Check the Gmail search, or the SquareTrade portal.' });
  }

  // 3) Pull each label PDF, host it printable.
  const bucket = process.env.TN_AWS_S3_BUCKET;
  const s3 = bucket ? new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } }) : null;
  const labels = [];
  for (const mm of msgs.slice(0, 6)) {
    const { subject, pdf, filename } = await pdfFromMessage(gmail, mm.id);
    const rmaM = /#\[?([0-9-]{5,})\]?/.exec(subject) || /RMA[^0-9]*([0-9-]{5,})/i.exec(subject);
    const rma = rmaM ? rmaM[1] : '';
    let pdf_url = '';
    if (pdf && s3) {
      try {
        const key = `social/return-labels/${(claim || 'box')}-${mm.id}.pdf`;
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: pdf, ContentType: 'application/pdf' }));
        pdf_url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: 'inline', ResponseContentType: 'application/pdf' }), { expiresIn: 7 * 24 * 3600 });
      } catch (_) {}
    }
    labels.push({ rma, subject, pdf_url, has_pdf: !!pdf_url, gmail_link: `https://mail.google.com/mail/u/0/#search/rfc822msgid:${mm.id}`, email_id: mm.id });
  }
  // A label with a printable PDF first.
  labels.sort((a, c) => (c.has_pdf - a.has_pdf));
  const gmail_search = claim ? `https://mail.google.com/mail/u/0/#search/${encodeURIComponent('from:rma_request@squaretrade.com ' + claim)}` : '';
  return json(200, { ok: true, ocr, matched_on: claim ? 'claim' : (cust ? 'customer' : ''), labels, gmail_search });
};
