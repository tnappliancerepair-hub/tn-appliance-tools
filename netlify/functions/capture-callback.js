// Vapi tool — capture a caller when Ant can't find/answer them, so NO call is
// lost during the HCP->Ant transition (data's still partly in HCP/MeisterTask).
// Logs a callback_request + texts the office immediately so a human follows up.
// The assistant calls this as its graceful fallback instead of a blind transfer.
//
// POST { name, phone, summary, caller_type, ref }  ->  { ok, say }

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;
const { sendSms } = require('./_lib/sms');
const guard = require('./_lib/sms-guard');
const OWNER = '+16154855795';
const DANIELLE = '+16154850713';

// Never auto-text an internal caller (owner/Danielle/techs/shop lines) a
// customer acknowledgment — a tech calling in shouldn't get the "thanks for
// calling" text. Matched on last-10 digits.
const INTERNAL_10 = new Set([
  '6154855795', // Teddy
  '6154850713', // Danielle
  '6159671304', // Jimmy
  '6159693115', '5049099413', // Andre
  '6158291654', // Lee
  '7315049617', // Billy
  '8133527686', // John
  '6155889500', '6158578800', '6152802949', '8662680111', '8882688998', '5043559111', // shop lines
]);
function isInternal(phone) { const d = String(phone || '').replace(/\D/g, '').slice(-10); return d.length === 10 && INTERNAL_10.has(d); }

// The immediate customer acknowledgment — closes the loop the second Ant
// promises a callback, so nobody's left hanging waiting on a human to work the
// queue (Vernon called twice because his first callback never came, Teddy 7/3).
// It also opens a repliable text thread: their reply flows into the inbound-SMS
// pipeline where Ant can auto-answer and collect availability.
function customerAck(name, callerType) {
  const who = String(name || '').trim().split(/\s+/)[0] || 'there';
  if (callerType === 'warranty') {
    return `Hi ${who}, it's Tennessee Appliance — thanks for calling! We've got your message and we're on it. We'll follow up shortly to get your warranty visit moving. Feel free to reply right here with anything that helps (like the days and times that work for you) and we'll take care of you.`;
  }
  return `Hi ${who}, it's Tennessee Appliance — thanks for calling! We've got your message and we're on it. Someone will reach out shortly. To speed things up, just reply right here with anything that helps — like the days and times that work best for you — and we'll get you taken care of.`;
}

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null;
}
function jsonResp(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  // Vapi sends tool args either at the top level or under message.toolCalls; accept both.
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (_) { b = {}; }
  const args = b.arguments || b.args || b;

  const name = String(args.name || '').slice(0, 80);
  const phone = String(args.phone || '').slice(0, 40);
  const summary = String(args.summary || args.need || '').slice(0, 600);
  const callerType = String(args.caller_type || 'customer').slice(0, 30); // customer | warranty | other
  const ref = String(args.ref || args.claim || '').slice(0, 60);

  // A captured caller must NOT be lost. Try the durable event_log write (it
  // feeds the office Callbacks queue) with retries, then the two SMS alerts
  // with one retry each. Track whether ANY path landed.
  async function retry(fn, attempts) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try { return await fn(); } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 300 * (i + 1))); }
    }
    throw lastErr || new Error('failed');
  }

  let logged = false, ownerSent = false, danielleSent = false;
  const h = headers();
  if (h) {
    try {
      await retry(async () => {
        const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
          method: 'POST', headers: h,
          body: JSON.stringify({ action: 'callback_request', metadata: { name, phone, summary, caller_type: callerType, ref, source: 'vapi', at_ms: Date.now() } }),
        });
        if (!r.ok) throw new Error('event_log ' + r.status);
        return true;
      }, 3);
      logged = true;
    } catch (_) { logged = false; }
  }

  const tag = callerType === 'warranty' ? 'WARRANTY' : 'customer';
  const alert = '[ant] 📞 callback needed (' + tag + '): ' + (name || '(no name)') + ' ' + (phone || '') +
    (ref ? (' · claim/WO ' + ref) : '') + ' — ' + (summary || 'see call') +
    '. Follow up: https://tnapplianceexchange.net/callbacks.html';

  // Fire all three in parallel to keep the live call snappy: office alerts (so a
  // human CAN still work it) + the immediate customer acknowledgment (so the
  // loop closes even if no human does). guardedSend enforces opt-out; internal
  // callers are skipped so a tech dialing in never gets the "thanks for calling"
  // text. allowQuiet: they literally just called us seconds ago.
  let customerAcked = false, customerAckReason = 'skipped';
  await Promise.allSettled([
    retry(() => sendSms(OWNER, alert, 'owner', 'vapi_callback'), 2).then(() => { ownerSent = true; }).catch(() => {}),
    retry(() => sendSms(DANIELLE, alert, 'warranty_handler', 'vapi_callback'), 2).then(() => { danielleSent = true; }).catch(() => {}),
    (async () => {
      if (!phone || isInternal(phone)) { customerAckReason = isInternal(phone) ? 'internal' : 'no_phone'; return; }
      try {
        const res = await guard.guardedSend({ phone, message: customerAck(name, callerType), tag: 'callback_ack', kind: 'callback_ack', allowQuiet: true });
        customerAcked = !!res.sent; customerAckReason = res.reason;
        if (res.sent) { try { const h2 = headers(); if (h2) await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, { method: 'POST', headers: h2, body: JSON.stringify({ action: 'callback_customer_acked', metadata: { phone: guard.toE164(phone), name, caller_type: callerType, at_ms: Date.now() } }) }); } catch (_) {} }
      } catch (_) { customerAckReason = 'error'; }
    })(),
  ]);

  const captured = logged || ownerSent || danielleSent;
  // Last-ditch visibility if EVERYTHING failed — at least surface it in the
  // function logs with a clear marker so it can be recovered manually.
  if (!captured) {
    console.error('CALLBACK_NOT_CAPTURED', JSON.stringify({ name, phone, summary, caller_type: callerType, ref, at: new Date().toISOString() }));
  }

  // Always reassure the caller (never alarm them mid-call). If we actually texted
  // them, tell them so — it sets a concrete expectation and invites the reply
  // that closes the loop without a human.
  const say = customerAcked
    ? "Got it — I've just sent a text to the number you're calling from so you have it in writing, and someone will follow up shortly. You can reply to that text anytime with the days and times that work for you. Anything else I can help with?"
    : "Got it — I've passed your info to our office and someone will reach out to you very shortly. Anything else I can help with in the meantime?";
  return jsonResp(200, { ok: true, captured, logged, customer_acked: customerAcked, customer_ack_reason: customerAckReason, say });
};
