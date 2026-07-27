// return-label-find — snap a photo of a part box → get its prepaid return label to print.
// The whole return grind (150 parts) is "which label goes with this box?". This reads the
// box with Claude Vision (claim # + customer + part), searches Gmail LIVE for the
// SquareTrade/Allstate RMA email (works even for boxes we never captured), and pulls the
// "PRINT MY LABEL" link out of that email — the exact button Teddy taps to print. Owner-gated.
//   POST { image_b64, secret }  ->  { ok, ocr, matched_on, labels:[{rma, claim, subject, label_url, gmail_link}] }
'use strict';
const { getSecret } = require('./_lib/secrets');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }
function b64d(s) { try { return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (_) { return ''; } }
const MODEL = 'claude-sonnet-5';
const OCR_PROMPT = `You are reading a photo of a shipping box for an appliance part being RETURNED under a warranty (SquareTrade / Allstate). There may be a FedEx label and other stickers. Extract what you can. Return STRICT JSON only, this shape:
{"claim_number":"<the Allstate/SquareTrade claim or dispatch number, usually 10-12 digits — the MOST important field>","customer_name":"<recipient name>","part_number":"<the appliance part number if shown>","rma_number":"<RMA/REF number if shown>","distributor":"<Marcone/Encompass/Reliable/UED/etc if shown>","tracking_number":"<the FedEx tracking number if shown>"}
Use "" for anything not visible. Do not guess the claim number — only report digits you can actually read.`;

async function gmailClient() {
  const id = process.env.GMAIL_CLIENT_ID, secret = process.env.GMAIL_CLIENT_SECRET, refresh = process.env.GMAIL_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  try { const { google } = require('googleapis'); const o = new google.auth.OAuth2(id, secret); o.setCredentials({ refresh_token: refresh }); return google.gmail({ version: 'v1', auth: o }); } catch (_) { return null; }
}

// Pull the "PRINT MY LABEL" link (and rma/claim) out of an RMA email.
async function labelFromMessage(gmail, id) {
  try {
    const full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const subject = ((full.data.payload.headers || []).find((h) => h.name.toLowerCase() === 'subject') || {}).value || '';
    let html = '';
    (function walk(p) { if (!p) return; const mt = (p.mimeType || '').toLowerCase(); if ((mt === 'text/html' || mt === 'text/plain') && p.body && p.body.data) html += b64d(p.body.data); if (p.parts) p.parts.forEach(walk); })(full.data.payload);
    // find the anchor whose visible text is (or contains) PRINT ... LABEL
    let labelUrl = '';
    const aRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
    while ((m = aRe.exec(html))) {
      const txt = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      if (/print/.test(txt) && /label/.test(txt) && /^https?:/i.test(m[1])) { labelUrl = m[1]; break; }
    }
    // fallback: any anchor mentioning label
    if (!labelUrl) { aRe.lastIndex = 0; while ((m = aRe.exec(html))) { const txt = m[2].replace(/<[^>]+>/g, ' ').toLowerCase(); if (/label/.test(txt) && /^https?:/i.test(m[1])) { labelUrl = m[1]; break; } } }
    const rmaM = /#\[?([0-9-]{5,})\]?/.exec(subject) || /RMA[^0-9]*([0-9-]{4,})/i.exec(subject);
    const claimM = /claim[^0-9]*([0-9]{8,})/i.exec(subject);
    return { subject, label_url: labelUrl, rma: rmaM ? rmaM[1] : '', claim: claimM ? claimM[1] : '' };
  } catch (_) { return { subject: '', label_url: '', rma: '', claim: '' }; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  let imgB64 = String(b.image_b64 || ''); let mediaType = b.media_type || 'image/jpeg';
  const mm = /^data:([^;]+);base64,(.*)$/i.exec(imgB64); if (mm) { mediaType = mm[1]; imgB64 = mm[2]; }
  if (!imgB64) return json(400, { ok: false, error: 'image_b64 required' });

  // 1) OCR the box. Never hard-error — a blurry/glossy label just means "retake it".
  let ocr = {}, rawText = '';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 500, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: imgB64 } }, { type: 'text', text: OCR_PROMPT }] }] }), signal: AbortSignal.timeout(22000) });
    const d = await r.json();
    rawText = (d && d.content && d.content[0] && d.content[0].text) || '';
    const clean = rawText.replace(/```json|```/g, '').trim();
    const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
    if (s >= 0 && e > s) { try { ocr = JSON.parse(clean.slice(s, e + 1)); } catch (_) {} }
    if (!Object.keys(ocr).length && clean) { try { ocr = JSON.parse(clean); } catch (_) {} }
  } catch (_) { /* fall through — treated as "couldn't read" below */ }

  const claimRaw = String(ocr.claim_number || '').replace(/[^0-9]/g, '');
  const custRaw = String(ocr.customer_name || '').trim();
  if (!claimRaw && !custRaw) {
    return json(200, { ok: true, ocr, labels: [], note: 'Could not read this label — retake the photo a bit closer and flatter (avoid glare), or type the claim # in.' });
  }

  const claim = String(ocr.claim_number || '').replace(/[^0-9]/g, '');
  const cust = String(ocr.customer_name || '').trim();
  const gmail = await gmailClient();
  if (!gmail) return json(200, { ok: true, ocr, labels: [], note: 'Gmail is not connected — cannot pull the label.' });

  // 2) Find the RMA label email(s) — claim # first (precise), then customer last name.
  const queries = [];
  if (claim) queries.push(`from:rma_request@squaretrade.com ${claim}`);
  if (cust) queries.push(`from:rma_request@squaretrade.com ${cust.split(/\s+/).slice(-1)[0]}`);
  let msgs = [], via = '';
  for (let i = 0; i < queries.length; i++) {
    try { const list = await gmail.users.messages.list({ userId: 'me', q: queries[i], maxResults: 10 }); if (list.data.messages && list.data.messages.length) { msgs = list.data.messages; via = i === 0 ? 'claim' : 'customer'; break; } } catch (_) {}
  }
  const gmail_search = claim ? `https://mail.google.com/mail/u/0/#search/${encodeURIComponent('from:rma_request@squaretrade.com ' + claim)}`
    : (cust ? `https://mail.google.com/mail/u/0/#search/${encodeURIComponent('from:rma_request@squaretrade.com ' + cust)}` : '');
  if (!msgs.length) return json(200, { ok: true, ocr, labels: [], gmail_search, note: 'No RMA label email found for this box yet — it may not have been issued. Check the Gmail search, or the SquareTrade portal.' });

  // 3) Pull the PRINT MY LABEL link from each (in parallel, capped, so we stay well
  //    under the sync timeout even on a cold start).
  let labels = await Promise.all(msgs.slice(0, 4).map(async (msg) => {
    const info = await labelFromMessage(gmail, msg.id);
    return { rma: info.rma, claim: info.claim, subject: info.subject, label_url: info.label_url, has_label: !!info.label_url, gmail_link: `https://mail.google.com/mail/u/0/#search/rfc822msgid:${msg.id}`, email_id: msg.id };
  }));
  // If we OCR'd a claim, put exact-claim matches first (customer-name search can pull neighbors).
  if (claim) labels.sort((a, c) => ((c.claim === claim) - (a.claim === claim)) || (c.has_label - a.has_label));
  else labels.sort((a, c) => (c.has_label - a.has_label));
  return json(200, { ok: true, ocr, matched_on: via, labels, gmail_search });
};
