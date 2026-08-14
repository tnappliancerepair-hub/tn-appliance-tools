// Vapi tool — capture a caller when Ant can't find/answer them, so NO call is
// lost during the HCP->Ant transition (data's still partly in HCP/MeisterTask).
// Logs a callback_request + texts the office immediately so a human follows up.
// The assistant calls this as its graceful fallback instead of a blind transfer.
//
// POST { name, phone, summary, caller_type, ref }  ->  { ok, say }

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;
const { sendFrom588 } = require('./_lib/sms');
const guard = require('./_lib/sms-guard');
// Callbacks are DELEGATED to Danielle + Sofia (Teddy 2026-08-14: "urgent call backs
// need to go to Danielle and Sofia not me — those are delegated"). The owner is no
// longer texted here. Both go out from the 588 line so Sofia (a fresh number) is
// sure to receive it — the 857 tech line doesn't reliably reach non-established numbers.
const DANIELLE = '+16154850713';
const SOFIA = process.env.SOFIA_PHONE_NUMBER || '+16292594602';

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
    return `Hi ${who}, it's Tennessee Appliance 🐜 Got your message and we're on it - we'll follow up shortly to get your warranty visit moving. Reply here with the days/times that work.`;
  }
  return `Hi ${who}, it's Tennessee Appliance 🐜 Got your message and we're on it - someone will reach out shortly. Reply here with the days/times that work best and we'll take care of you.`;
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

  let logged = false, danielleSent = false, sofiaSent = false;
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

  // URGENT vs routine (Teddy 2026-07-06): only URGENT callbacks buzz Teddy's
  // phone; routine ones just sit in the Callbacks queue so he's not pestered all
  // day. Urgent = a warranty/AHS rep or dispatch, expedited/medical, OR clearly
  // upset language (no-show, damage, "no one calls me back," repeat problem).
  function isUrgent() {
    const ct = callerType.toLowerCase();
    if (ct.indexOf('warranty') !== -1 || ct.indexOf('rep') !== -1) return true;
    const s = (summary + ' ' + ref).toLowerCase();
    return /urgent|expedit|emergency|medical|insulin|medication|no[-\s]?show|never\s*(show|came|come)|no\s*one\s*(show|came|come)|did\s*n'?t\s*(show|come|make)|didnt\s*(show|come)|missed\s*(the\s*)?appointment|(no\s*(one|body)|never|still\s*(have\s*)?n'?t)\s*(ever\s*)?call|damage|flood|leak|water\s*everywhere|angry|upset|furious|frustrat|manager|complain|refund|escalat|asap|right\s*now|multiple\s*times|third\s*time|second\s*time|come\s*back\s*out/.test(s);
  }
  const urgent = isUrgent();
  // Safety net: if the durable queue write failed, alert even a routine one so it
  // is never silently lost. Alerts go to the delegated dispatchers (Danielle +
  // Sofia), never the owner.
  const alertDispatchers = urgent || !logged;

  const tag = urgent ? '🚨 URGENT' : (!logged ? '(queue-write failed)' : (callerType === 'warranty' ? 'WARRANTY' : 'customer'));
  const alert = '[ant] 📞 callback (' + tag + '): ' + (name || '(no name)') + ' ' + (phone || '') +
    (ref ? (' · claim/WO ' + ref) : '') + ' — ' + (summary || 'see call') +
    '. Call back: https://tnapplianceexchange.net/callbacks.html';

  // Fire in parallel to keep the live call snappy. Danielle + Sofia get a text ONLY
  // when it's urgent (routine callbacks live quietly in the queue). The immediate
  // customer acknowledgment always fires so the loop closes even if no human works
  // it. guardedSend enforces opt-out; internal callers are skipped so a tech
  // dialing in never gets the "thanks for calling" text.
  let customerAcked = false, customerAckReason = 'skipped';
  await Promise.allSettled([
    alertDispatchers ? retry(() => sendFrom588(DANIELLE, alert, 'vapi_callback_urgent'), 2).then((ok) => { danielleSent = !!ok; }).catch(() => {}) : Promise.resolve(),
    alertDispatchers ? retry(() => sendFrom588(SOFIA, alert, 'vapi_callback_urgent'), 2).then((ok) => { sofiaSent = !!ok; }).catch(() => {}) : Promise.resolve(),
    (async () => {
      if (!phone || isInternal(phone)) { customerAckReason = isInternal(phone) ? 'internal' : 'no_phone'; return; }
      try {
        const res = await guard.guardedSend({ phone, message: customerAck(name, callerType), tag: 'callback_ack', kind: 'callback_ack', allowQuiet: true });
        customerAcked = !!res.sent; customerAckReason = res.reason;
        if (res.sent) { try { const h2 = headers(); if (h2) await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, { method: 'POST', headers: h2, body: JSON.stringify({ action: 'callback_customer_acked', metadata: { phone: guard.toE164(phone), name, caller_type: callerType, at_ms: Date.now() } }) }); } catch (_) {} }
      } catch (_) { customerAckReason = 'error'; }
    })(),
  ]);

  const captured = logged || danielleSent || sofiaSent;
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
  return jsonResp(200, { ok: true, captured, logged, urgent, danielle_alerted: danielleSent, sofia_alerted: sofiaSent, customer_acked: customerAcked, customer_ack_reason: customerAckReason, say });
};
