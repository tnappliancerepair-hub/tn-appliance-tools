// message-reply — one-tap "we got your message" text back to a caller from the
// office message inbox (callbacks.html). Quick acknowledgement so nobody who
// leaves a message is left hanging.
//
//   POST { phone, name?, day?, callback_id? } -> { ok, sent }

'use strict';

const { sendSms } = require('./_lib/sms');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const phone = String(b.phone || '').trim();
  if (!phone || phone.replace(/\D/g, '').length < 10) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'valid phone required' }) };
  const first = (String(b.name || '').trim().split(/\s+/)[0]) || 'there';
  const day = String(b.day || '').trim();
  // Custom message (e.g. a callback text from the dropped-calls board) overrides
  // the default "we got your message" ack. Capped to stay SMS-friendly.
  const custom = String(b.message || '').trim();
  const msg = custom
    ? custom.slice(0, 600)
    : ('Hi ' + first + ", it's TN Appliance Exchange 🐜 — we got your message! We're getting you on the schedule"
      + (day ? (' for ' + day) : '') + '. Someone will reach out to confirm. Thanks for your patience!');

  let sent = false, err = null;
  try { await sendSms(phone, msg, 'customer', 'message_reply'); sent = true; }
  catch (e) { err = String((e && e.message) || e); }

  // audit
  try {
    const tok = process.env.XANO_METADATA_TOKEN;
    if (tok) await fetch(`${META}/table/3/content`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'message_text_back_sent', metadata: { phone, name: b.name || '', day, callback_id: b.callback_id || null, at_ms: Date.now() } }) });
  } catch (_) {}

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: sent, sent, error: err }) };
};
