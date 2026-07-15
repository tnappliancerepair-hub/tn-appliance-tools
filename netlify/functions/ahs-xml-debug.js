// ahs-xml-debug — fetch the raw dispatch.xml off recent AHS/Frontdoor emails so we can see
// the EXACT format that makes the street/name parse drop ("1, City", unsplit names). Owner-
// gated, READ-ONLY (never modifies mail, never posts to Xano).
//   GET ?secret=<admin>[&q=<gmail query>][&max=5][&full=1]
'use strict';
const { google } = require('googleapis');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function findXml(payload) {
  if (!payload) return null;
  const parts = payload.parts || [];
  for (const p of parts) {
    const fn = (p.filename || '').toLowerCase();
    if ((fn.endsWith('.xml') || (p.mimeType || '').includes('xml')) && p.body && p.body.attachmentId) return { attachmentId: p.body.attachmentId, filename: p.filename };
    const nested = findXml(p);
    if (nested) return nested;
  }
  return null;
}
// Pull just the address + name blocks out of the XML so the diagnosis is readable.
function slice(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '[^>]*>', 'i'));
  return m ? m[0] : '';
}

exports.handler = async (event) => {
  const q0 = event.queryStringParameters || {};
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q0.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const query = String(q0.q || 'from:frontdoorhome.com has:attachment newer_than:20d');
  const max = Math.min(parseInt(q0.max, 10) || 5, 12);
  const clientId = process.env.GMAIL_CLIENT_ID, clientSecret = process.env.GMAIL_CLIENT_SECRET, refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return json(500, { ok: false, error: 'gmail env missing' });
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret); oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  try {
    const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: max });
    const msgs = (list.data.messages) || [];
    if (!msgs.length) return json(200, { ok: true, found: false, query });
    const out = [];
    for (const { id } of msgs.slice(0, max)) {
      const m = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const headers = (m.data.payload.headers) || [];
      const h = (n) => ((headers.find((x) => x.name.toLowerCase() === n) || {}).value) || '';
      const att = findXml(m.data.payload);
      let xml = '';
      if (att) { const a = await gmail.users.messages.attachments.get({ userId: 'me', messageId: id, id: att.attachmentId }); xml = Buffer.from(a.data.data, 'base64url').toString('utf8'); }
      out.push({
        id, subject: h('subject').slice(0, 100), from: h('from').slice(0, 60), date: h('date'), has_xml: !!att,
        // the diagnosis-relevant blocks:
        covered_property: slice(xml, 'CoveredProperty'),
        commercial_property: slice(xml, 'CommercialProperty'),
        contract_customer: slice(xml, 'ContractCustomer'),
        dispatch_contact: slice(xml, 'DispatchContact'),
        xml: q0.full === '1' ? xml : undefined,
      });
    }
    return json(200, { ok: true, query, count: out.length, messages: out });
  } catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }
};
