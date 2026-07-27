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
const OCR_PROMPT = `You are reading a photo of a shipping box for an appliance part. The box was shipped by a distributor (Marcone / Encompass / Reliable / UED) and now needs its warranty RETURN label. Read the stickers on the box. Return STRICT JSON only, this shape:
{"claim_number":"<the Allstate/SquareTrade claim or dispatch number, usually 10-12 digits>","customer_name":"<recipient name>","part_number":"<the APPLIANCE PART NUMBER, e.g. W10919003, DA97-19973A, WE03X38319, 4738ER1002A — the single most important field for telling this box apart from the customer's other parts>","rma_number":"<RMA/REF number if shown>","distributor":"<Marcone/Encompass/Reliable/UED/etc if shown>","tracking_number":"<the FedEx tracking number if shown>"}
The PART NUMBER is the key field — it's an alphanumeric code (often 7-12 chars, sometimes with a dash) usually near a "Part", "P/N", "Part No.", or "MPN" label, or printed large on the distributor sticker. Read it EXACTLY, character by character (watch 0/O, 1/I, 5/S, 8/B). Use "" for anything you cannot actually read — never guess the claim number or the part number.`;

async function gmailClient() {
  const id = process.env.GMAIL_CLIENT_ID, secret = process.env.GMAIL_CLIENT_SECRET, refresh = process.env.GMAIL_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  try { const { google } = require('googleapis'); const o = new google.auth.OAuth2(id, secret); o.setCredentials({ refresh_token: refresh }); return google.gmail({ version: 'v1', auth: o }); } catch (_) { return null; }
}

const normPart = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Pull the "PRINT MY LABEL" link + the part it's for out of ONE RMA email.
// The email body literally names the part: "Part Number: W10919003", plus the
// distributor, FedEx tracking, and customer — that's how we tell WHICH of a
// claim's several labels goes with the box in Teddy's hand.
async function labelFromMessage(gmail, id) {
  try {
    const full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const hdrs = full.data.payload.headers || [];
    const subject = (hdrs.find((h) => h.name.toLowerCase() === 'subject') || {}).value || '';
    const messageId = ((hdrs.find((h) => h.name.toLowerCase() === 'message-id') || {}).value || '').replace(/[<>]/g, '').trim();
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
    // clean the visible text (drop <style>/<script>) then read the labeled fields
    const body = html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const pick = (re) => { const x = re.exec(body); return x ? x[1].trim() : ''; };
    const rmaM = /RMA\s*#?\s*is\s*([0-9-]{4,})/i.exec(body) || /#\[?([0-9-]{5,})\]?/.exec(subject) || /RMA[^0-9]*([0-9-]{4,})/i.exec(subject);
    const claimM = /Claim\s*Number:\s*([0-9]{8,})/i.exec(body) || /claim[^0-9]*([0-9]{8,})/i.exec(subject);
    return {
      subject,
      message_id: messageId,
      label_url: labelUrl,
      rma: rmaM ? rmaM[1] : '',
      claim: claimM ? claimM[1] : '',
      part_number: pick(/Part\s*Number:\s*([A-Za-z0-9./-]{3,})/i),
      distributor: pick(/Distributor:\s*([A-Za-z0-9 &-]+?)\s+(?:Part\s*Number|Return|Details|Customer)/i),
      return_desc: pick(/Return\s*Description:\s*([A-Za-z0-9 ]+?)\s+(?:Details|Customer|Thanks)/i),
      fedex_tracking: pick(/FedEx\s*tracking\s*#?\s*is\s*([0-9]{8,})/i),
      customer_name: pick(/Customer\s*Name:\s*([A-Za-z ,.'-]+?)\s+Claim\s*Number/i),
    };
  } catch (_) { return { subject: '', message_id: '', label_url: '', rma: '', claim: '', part_number: '', distributor: '', return_desc: '', fedex_tracking: '', customer_name: '' }; }
}

// A Gmail deep-link that ACTUALLY opens the message. rfc822msgid: needs the real
// Message-ID header (not Gmail's API id — that was the "random empty search" bug).
// Falls back to #all/<apiId>, which Gmail also resolves by internal id.
const GMAIL_ACCT = 'tnappliancerepair@gmail.com';
function gmailOpenLink(apiId, messageId) {
  if (messageId) return `https://mail.google.com/mail/u/${GMAIL_ACCT}/#search/${encodeURIComponent('rfc822msgid:' + messageId)}`;
  return `https://mail.google.com/mail/u/${GMAIL_ACCT}/#all/${apiId}`;
}

// Resolve the DIRECT label image behind SquareTrade's "PRINT MY LABEL" link.
// Their in-browser viewer is a flaky JS app that prints blank ("Unit repair form
// could not be loaded") on mobile. But the print link redirects to a provisional
// JWT, and their label API hands back a static PNG of the actual FedEx label — so
// we grab that and give Teddy a clean, preloaded, printable image every time.
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1';
async function resolveLabelImage(printUrl) {
  if (!printUrl) return '';
  try {
    let url = printUrl, token = '', sid = '', hops = 0;
    while (hops++ < 6) {
      const r = await fetch(url, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      const loc = r.headers.get('location') || '';
      const tm = /token=([^&\s]+)/.exec(loc);
      const sm = /shippingId=([0-9]+)/.exec(loc);
      if (tm) token = tm[1];
      if (sm) sid = sm[1];
      if (token && sid) break;
      if (loc && /^https?:/i.test(loc)) { url = loc; continue; }
      break;
    }
    if (!token || !sid) return '';
    const a = await fetch(`https://www.squaretrade.com/api/shipping/v1/labels/${sid}`, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!a.ok) return '';
    const j = await a.json();
    const urls = ((((j.body || [])[0] || {}).entity || {}).labelURLs) || [];
    return urls[0] || '';
  } catch (_) { return ''; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  let imgB64 = String(b.image_b64 || ''); let mediaType = b.media_type || 'image/jpeg';
  const mm = /^data:([^;]+);base64,(.*)$/i.exec(imgB64); if (mm) { mediaType = mm[1]; imgB64 = mm[2]; }
  // Manual fallback: type the claim # (or customer name) off the box when the camera can't read it.
  const typed = String(b.query || b.claim || '').trim();
  if (!imgB64 && !typed) return json(400, { ok: false, error: 'image_b64 or claim/query required' });

  // 1) Read the box — typed value skips OCR; otherwise Vision. Never hard-error.
  let ocr = {}, rawText = '';
  if (typed) {
    // Parse the typed input into claim / part / name. Teddy can type the claim,
    // or "claim part#", or just a name — a part-looking token (letters+digits)
    // still drives the per-part match.
    const tokens = typed.split(/[\s,]+/).filter(Boolean);
    const claimTok = tokens.map((t) => t.replace(/[^0-9]/g, '')).find((d) => d.length >= 8) || '';
    const partTok = tokens.find((t) => /[A-Za-z]/.test(t) && /[0-9]/.test(t) && t.replace(/[^A-Za-z0-9]/g, '').length >= 5) || '';
    if (claimTok) ocr.claim_number = claimTok;
    if (partTok) ocr.part_number = partTok;
    if (!claimTok && !partTok) ocr.customer_name = typed;
    else if (!claimTok && !ocr.customer_name) { const nameTok = tokens.filter((t) => !/[0-9]/.test(t)).join(' '); if (nameTok) ocr.customer_name = nameTok; }
  } else try {
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
  const gmail_search = claim ? `https://mail.google.com/mail/u/${GMAIL_ACCT}/#search/${encodeURIComponent('from:rma_request@squaretrade.com ' + claim)}`
    : (cust ? `https://mail.google.com/mail/u/${GMAIL_ACCT}/#search/${encodeURIComponent('from:rma_request@squaretrade.com ' + cust)}` : '');
  if (!msgs.length) return json(200, { ok: true, ocr, labels: [], gmail_search, note: 'No RMA label email found for this box yet — it may not have been issued. Check the Gmail search, or the SquareTrade portal.' });

  // 3) Pull the PRINT MY LABEL link + the part each is for (in parallel, capped
  //    higher so multi-part claims — Tovar had 4, Fleming 5 — all come back).
  const boxPart = normPart(ocr.part_number);
  let labels = await Promise.all(msgs.slice(0, 8).map(async (msg) => {
    const info = await labelFromMessage(gmail, msg.id);
    const part_match = !!(boxPart && info.part_number && normPart(info.part_number) === boxPart);
    const rawImg = await resolveLabelImage(info.label_url);            // the real printable PNG (S3, octet-stream)
    const label_image_url = rawImg ? `/.netlify/functions/return-label-image?u=${encodeURIComponent(rawImg)}` : '';  // proxied → shows inline, prints clean
    return {
      rma: info.rma, claim: info.claim, subject: info.subject,
      part_number: info.part_number, distributor: info.distributor,
      return_desc: info.return_desc, customer_name: info.customer_name,
      fedex_tracking: info.fedex_tracking,
      part_match,
      label_url: info.label_url, label_image_url, has_image: !!label_image_url, has_label: !!info.label_url,
      gmail_link: gmailOpenLink(msg.id, info.message_id), email_id: msg.id,
    };
  }));
  // Rank: the label for THIS box's part first, then exact-claim, then has-a-link.
  labels.sort((a, c) => (c.part_match - a.part_match) || ((c.claim === claim) - (a.claim === claim)) || (c.has_label - a.has_label));
  const matched_part = boxPart ? (labels.find((l) => l.part_match) ? ocr.part_number : '') : '';
  return json(200, { ok: true, ocr, matched_on: via, box_part: ocr.part_number || '', matched_part, multi: labels.length > 1, labels, gmail_search });
};
