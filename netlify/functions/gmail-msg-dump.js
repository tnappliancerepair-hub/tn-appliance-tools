// gmail-msg-dump — owner-gated: dump ONE Gmail message's structure so we can see how a
// return label is actually delivered (PDF attachment vs inline image vs a print link).
//   GET ?secret=<admin>&id=<messageId>
'use strict';
const { getSecret } = require('./_lib/secrets');
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function b64d(s) { try { return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (_) { return ''; } }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { error: 'unauthorized' });
  if (!q.id) return json(400, { error: 'pass ?id=' });
  const { google } = require('googleapis');
  const o = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
  o.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  const gmail = google.gmail({ version: 'v1', auth: o });
  const full = await gmail.users.messages.get({ userId: 'me', id: q.id, format: 'full' });
  const hdrs = (full.data.payload.headers || []);
  const subject = (hdrs.find((h) => h.name.toLowerCase() === 'subject') || {}).value || '';
  const parts = [];
  let text = '';
  let attachId = '', attachName = '';
  (function walk(p, path) {
    if (!p) return;
    parts.push({ path, mimeType: p.mimeType, filename: p.filename || '', hasAttachment: !!(p.body && p.body.attachmentId), size: (p.body && p.body.size) || 0 });
    const mt = (p.mimeType || '').toLowerCase();
    if ((mt === 'text/plain' || mt === 'text/html') && p.body && p.body.data && text.length < 8000) text += '\n\n[' + mt + ']\n' + b64d(p.body.data);
    // capture the first attachment (CSV/PDF) so we can decode it with &attach=1
    if (p.body && p.body.attachmentId && !attachId) { attachId = p.body.attachmentId; attachName = p.filename || ''; }
    if (p.parts) p.parts.forEach((c, i) => walk(c, path + '.' + i));
  })(full.data.payload, '0');
  // &attach=1 → decode the first attachment (CSV report) as UTF-8 text
  if (q.attach === '1' && attachId) {
    try {
      const a = await gmail.users.messages.attachments.get({ userId: 'me', messageId: q.id, id: attachId });
      const decoded = b64d(a.data.data);
      return json(200, { subject, attachment: attachName, attachment_text: decoded.slice(0, 12000) });
    } catch (e) { return json(200, { subject, attachment: attachName, error: 'attachment decode failed: ' + String((e && e.message) || e) }); }
  }
  // pull any hrefs / print-label links out of the body
  const allLinks = [...new Set((text.match(/https?:\/\/[^\s"'<>)]+/g) || []))];
  const labelLinks = allLinks.filter((u) => /label|fedex|rma|print|return|ship|track|pdf|document|attachment|/i.test(u));
  // also pull anchor text→href pairs so we can see which link says "print label"
  const anchors = [];
  const aRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let mm;
  while ((mm = aRe.exec(text)) && anchors.length < 40) { const txt = mm[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); if (mm[1].startsWith('http')) anchors.push({ text: txt, href: mm[1].slice(0, 200) }); }
  return json(200, { subject, parts, all_links: allLinks.slice(0, 40), anchors, body_text: text.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0, 2500) });
};
