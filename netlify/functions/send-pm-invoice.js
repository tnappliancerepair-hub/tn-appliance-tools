// send-pm-invoice — text OR email a PM their invoice + the pay-and-save-card link.
// Admin-gated. SMS goes via Telnyx (the shared sms lib); email goes via the connected
// Gmail (tnappliancerepair@gmail.com) as a clean HTML invoice with a Pay button.
//
// POST { secret, channel:'sms'|'email', to, company?, invoice_number?, amount_cents,
//        pay_url, address?, appliance?, dry? }
'use strict';
const { google } = require('googleapis');
const { sendSms } = require('./_lib/sms');
exports.config = { timeout: 22 };
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
const s = (v, n) => String(v == null ? '' : v).slice(0, n == null ? 200 : n).trim();
const dollars = (c) => '$' + ((Number(c) || 0) / 100).toFixed(2);

function buildEmail(to, subject, html) {
  const from = 'TN Appliance Exchange <tnappliancerepair@gmail.com>';
  const lines = [
    'From: ' + from,
    'To: ' + to,
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
  ].join('\r\n');
  return Buffer.from(lines).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'invalid_json' }); }
  if (s(b.secret, 80) !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const channel = s(b.channel, 10);
  const to = s(b.to, 160);
  const company = s(b.company, 120) || 'your account';
  const invNo = s(b.invoice_number, 40);
  const amount = Math.round(Number(b.amount_cents) || 0);
  const payUrl = s(b.pay_url, 900);
  const address = s(b.address, 160);
  const appliance = s(b.appliance, 80) || 'appliance repair';
  const contact = s(b.contact, 80);
  const subtotal = Math.round(Number(b.subtotal_cents) || 0);
  const tax = Math.round(Number(b.tax_cents) || 0);
  if (!to || !payUrl || amount <= 0) return json(400, { ok: false, error: 'to, pay_url, amount_cents required' });

  if (channel === 'sms') {
    const msg = 'TN Appliance Exchange: your invoice' + (invNo ? (' ' + invNo) : '') + ' for ' + appliance +
      (address ? (' at ' + address) : '') + ' is ' + dollars(amount) + '. Pay securely (and we’ll keep your card on file for hands-off billing on future repairs): ' + payUrl;
    if (b.dry) return json(200, { ok: true, dry: true, channel: 'sms', to, preview: msg });
    try { const r = await sendSms(to, msg, 'customer', 'pm_invoice'); return json(200, { ok: true, channel: 'sms', to, sent: r }); }
    catch (e) { return json(200, { ok: false, channel: 'sms', error: e.message }); }
  }

  if (channel === 'email') {
    const subject = 'Invoice' + (invNo ? (' ' + invNo) : '') + ' from TN Appliance Exchange — ' + dollars(amount);
    const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1d24;max-width:560px;margin:0 auto;padding:8px">'
      + '<div style="border-bottom:3px solid #ff6200;padding-bottom:12px;margin-bottom:18px"><span style="font-size:22px">🐜</span> <b style="font-size:17px">TN Appliance Exchange LLC</b><div style="font-size:12px;color:#6b7280;margin-top:2px">Appliance Repair · Family-Owned Since 2012</div></div>'
      + '<p style="font-size:14px;line-height:1.7">Hi ' + (contact || company) + ',</p>'
      + '<p style="font-size:14px;line-height:1.7">Here is your invoice' + (invNo ? (' <b>' + invNo + '</b>') : '') + ' for the ' + appliance + (address ? (' at <b>' + address + '</b>') : '') + '.</p>'
      + '<div style="background:#faf7f3;border:1px solid #e5e7eb;border-left:4px solid #ff6200;border-radius:8px;padding:16px 18px;margin:16px 0">'
      + (subtotal > 0 ? ('<div style="display:flex;justify-content:space-between;font-size:13px;color:#4b5563;padding:2px 0"><span>Subtotal</span><span>' + dollars(subtotal) + '</span></div>' + (tax > 0 ? ('<div style="display:flex;justify-content:space-between;font-size:13px;color:#4b5563;padding:2px 0"><span>TN sales tax (9.75%)</span><span>' + dollars(tax) + '</span></div>') : '') + '<div style="border-top:1px solid #e5e7eb;margin:8px 0 6px"></div>') : '')
      + '<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Total Due</span><span style="font-size:26px;font-weight:800;color:#ff6200">' + dollars(amount) + '</span></div></div>'
      + '<div style="text-align:center;margin:22px 0"><a href="' + payUrl + '" style="display:inline-block;background:#ff6200;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 30px;border-radius:10px">Pay securely online →</a></div>'
      + '<p style="font-size:13px;line-height:1.7;color:#4b5563">Tap once to pay — and we’ll keep your card securely on file (stored by Stripe, we never see the number) so future repairs at your properties bill automatically, with anything over your pre-authorized amount coming to you for a one-tap OK first. One vendor, one portal, one monthly view.</p>'
      + '<p style="font-size:13px;line-height:1.7;color:#4b5563">Questions? Just reply here or call us at 615-280-2949.</p>'
      + '<div style="border-top:1px solid #e5e7eb;margin-top:20px;padding-top:12px;font-size:11px;color:#9ca3af">TN Appliance Exchange LLC · Middle Tennessee &amp; Louisiana · 615-280-2949 · tnapplianceexchange.net</div>'
      + '</div>';
    if (b.dry) return json(200, { ok: true, dry: true, channel: 'email', to, subject, preview: html.slice(0, 300) });
    const cid = process.env.GMAIL_CLIENT_ID, csec = process.env.GMAIL_CLIENT_SECRET, rt = process.env.GMAIL_REFRESH_TOKEN;
    if (!cid || !csec || !rt) return json(500, { ok: false, error: 'gmail_not_configured' });
    try {
      const oauth2 = new google.auth.OAuth2(cid, csec); oauth2.setCredentials({ refresh_token: rt });
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });
      const raw = buildEmail(to, subject, html);
      const r = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      return json(200, { ok: true, channel: 'email', to, message_id: r.data.id });
    } catch (e) { return json(200, { ok: false, channel: 'email', error: e.message }); }
  }

  return json(400, { ok: false, error: 'channel must be sms or email' });
};
