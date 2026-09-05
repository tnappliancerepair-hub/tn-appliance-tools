// platform-contact — PUBLIC "Message us" endpoint for the AssistAnt marketing site. A prospect who
// wants to ask something before signing up submits the contact widget; this (1) captures it durably in
// the platform `prospect_message` table so nothing is ever lost, and (2) pings Teddy both ways (text +
// email) so he sees it right away. Bot-guarded by a honeypot; never charges, never provisions.
//
//   POST { name, phone?, email?, message, shop?, source?, company_website? }  ->  { ok, message }
'use strict';

const { platform } = require('./_lib/platform-rest');
const notify = require('./_lib/platform-notify');

function J(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 400);

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return J(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = event.body ? JSON.parse(event.body) : {}; } catch (_) {}

  // Honeypot: a real person leaves this hidden field blank; a bot fills it. Silently "succeed" + drop.
  if (s(b.company_website, 200)) return J(200, { ok: true, message: 'Got it — we’ll be in touch shortly.' });

  const name = s(b.name, 120);
  const phone = s(b.phone, 40);
  const email = s(b.email, 160);
  const message = s(b.message, 2000);
  const shop = s(b.shop, 160);
  const source = s(b.source, 60) || 'site';

  if (!message) return J(400, { ok: false, error: 'message_required', message: 'Please add a quick note so we know how to help.' });
  if (!phone && !email) return J(400, { ok: false, error: 'contact_required', message: 'Add a phone or email so we can reach you.' });

  // 1) Durable capture (best-effort — even if the DB write fails, the text+email below still deliver it).
  try {
    const pf = await platform();
    if (pf) await pf.insert('prospect_message', { name, phone, email, message, shop, source });
  } catch (_) {}

  // 2) Ping Teddy both ways.
  const who = name || shop || phone || email || 'A prospect';
  const reach = [phone && ('📞 ' + phone), email && ('✉️ ' + email)].filter(Boolean).join('  ');
  try {
    await notify.notifyOperator({
      tag: 'prospect_message',
      sms: `💬 AssistAnt message from ${who}${shop && shop !== name ? ' (' + shop + ')' : ''}: "${message.slice(0, 300)}" — ${reach}`,
      subject: `AssistAnt inquiry — ${who}`,
      email_body: `New "Message us" from the site (${source}).\n\nName: ${name || '—'}\nShop: ${shop || '—'}\nPhone: ${phone || '—'}\nEmail: ${email || '—'}\n\nMessage:\n${message}\n\nReceived: ${new Date().toISOString()}`,
    });
  } catch (_) {}

  return J(200, { ok: true, message: 'Got it — we’ll be in touch shortly.' });
};
