// Inbound voice-call webhook for Ant.
//
// Forwards Telnyx call.initiated events to Xano's record_inbound_call
// endpoint, which emits an INBOUND_CALL colony signal. The colony loop's
// inbound_call.js agent then SMSes Teddy + Danielle with caller context
// (customer name, last job, last visit days-ago) and a deep-link to
// customer-search.html?phone=XXX so they can pull up the full record in
// one tap.
//
// ─── Webhook URL to configure ──────────────────────────────────────
// Telnyx portal -> Voice → Programmable Voice Applications -> your app
//   Webhook URL:
//     https://tnapplianceexchange.net/.netlify/functions/inbound-call-webhook
//   Webhook event types: call.initiated (sufficient — we don't need
//     call.answered / call.hangup for the alert path)
//
// Always returns 200 immediately so Telnyx doesn't retry. The Xano POST
// is fire-and-await but with a 9s ceiling — typical latency is ~200ms.

const XANO_RECORD_INBOUND_CALL =
  'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/record_inbound_call';
const XANO_EMERGENCY_SMS =
  'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/emergency_customer_sms';
const XANO_TRANSFER_CALL =
  'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/transfer_telnyx_call';
const XANO_TIMEOUT_MS = 9000;

// Forward inbound calls on the vanity numbers to the Vapi-assigned
// number (+16292607111) where the Ant Inbound agent is already live.
// Telnyx Call Control requires us to issue a transfer command (not
// simple auto-forwarding) because the vanity numbers are attached to
// a Voice App. INBOUND_TRANSFER_TO env var overrides if needed.
const TRANSFER_TO = process.env.INBOUND_TRANSFER_TO || '+16292607111';

// Ant's OWN numbers (Vapi BYO + Telnyx + toll-free). A call.initiated whose
// caller is one of these is a routing/loop artifact, NEVER a real customer —
// it must be dropped immediately (no auto-ack, no transfer, no record, no
// alert), or it feeds a feedback loop: webhook transfers to 629 + records →
// 629's leg re-enters the webhook → transfer + record again → SMS storm.
const ANT_OWN_NUMBERS = new Set([
  '6292607111', // Ant Inbound (Vapi)
  '6292477111', // Vapi BYO TN
  '5043559111', // Vapi BYO LA
  '5043800975', // LA backup
  '7315031142', // West TN fallback
  '6155889500', // Telnyx customer-direction
  '6158578800', // Telnyx tech-direction
  '8662680111', // toll-free
  '8882688998', // toll-free
  '6152802949', // main line (porting in)
  '6292840444', // business SMS
  '7273508487', // legacy tech inbound
]);
function last10Digits(p) {
  return String(p || '').replace(/\D/g, '').slice(-10);
}

// Belt-and-suspenders: text the caller immediately on every inbound call
// (deduped 6h on the Xano side). Even if Vapi takes the call, the text
// gives the customer a way to escalate to SMS if voice doesn't work for
// them. Routed through emergency_customer_sms which bypasses the global
// CUSTOMER_FACING_ENABLED gate so this fires regardless of operational
// posture. Safe by design: dedup prevents spam.
const AUTO_ACK_TEXT = "Hi! It's TN Appliance Exchange — we got your call. If we don't pick up, just text back here with your appliance type + zip and we'll set up your repair. Or we'll call back shortly.";

async function fireCustomerAutoAck(callerPhone) {
  if (!callerPhone) return;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), XANO_TIMEOUT_MS);
    const res = await fetch(XANO_EMERGENCY_SMS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: callerPhone,
        body: AUTO_ACK_TEXT,
        source: 'inbound_call_auto_ack',
      }),
      signal: ctl.signal,
    });
    clearTimeout(t);
    const j = await res.json().catch(() => ({}));
    console.log('[inbound-call-webhook] auto-ack', res.status, j);
  } catch (e) {
    console.warn('[inbound-call-webhook] auto-ack failed:', e.message);
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    console.warn('[inbound-call-webhook] parse fail:', e.message);
    return { statusCode: 200, body: 'ack' };
  }

  // Telnyx v2 payload structure: data.event_type + data.payload.{from,to,...}
  const eventType = body && body.data && body.data.event_type;
  if (eventType !== 'call.initiated') {
    console.log('[inbound-call-webhook] ignoring event_type:', eventType);
    return { statusCode: 200, body: 'ack' };
  }

  const payload = (body && body.data && body.data.payload) || {};
  const from = String(payload.from || '').trim();
  const callId = String(payload.call_control_id || payload.call_session_id || '').trim();

  if (!from) {
    console.warn('[inbound-call-webhook] missing from in payload');
    return { statusCode: 200, body: 'ack' };
  }

  // LOOP GUARD: drop calls originating from one of Ant's own numbers. These
  // are never real customers — they're routing artifacts that otherwise feed
  // a transfer+record feedback loop (the 1409-SMS storm). Ack and stop.
  if (ANT_OWN_NUMBERS.has(last10Digits(from))) {
    console.log('[inbound-call-webhook] IGNORING self-call loop from own number', from);
    return { statusCode: 200, body: 'ack-self-call-ignored' };
  }

  console.log('[inbound-call-webhook] inbound from', from, 'callId', callId);

  // FIRE-AND-FORGET customer auto-ack via emergency endpoint (dedup'd 6h)
  fireCustomerAutoAck(from);

  // Issue the Telnyx Call Control "transfer" command so the inbound
  // call rings Teddy's cell. Fire-and-await with short timeout so
  // Telnyx still gets a 200 quickly.
  if (callId) {
    try {
      const tCtl = new AbortController();
      const tTimer = setTimeout(() => tCtl.abort(), XANO_TIMEOUT_MS);
      const tRes = await fetch(XANO_TRANSFER_CALL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_control_id: callId, to: TRANSFER_TO }),
        signal: tCtl.signal,
      });
      clearTimeout(tTimer);
      const tJson = await tRes.json().catch(() => ({}));
      console.log('[inbound-call-webhook] transfer', tRes.status, tJson);
    } catch (e) {
      console.warn('[inbound-call-webhook] transfer failed:', e.message);
    }
  }

  // Forward to Xano with a timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), XANO_TIMEOUT_MS);
  try {
    const res = await fetch(XANO_RECORD_INBOUND_CALL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caller_phone: from,
        source: 'telnyx_voice_webhook',
        telnyx_call_id: callId,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    console.log('[inbound-call-webhook] xano response', res.status, data);
  } catch (err) {
    console.warn('[inbound-call-webhook] xano forward failed:', err.message);
  } finally {
    clearTimeout(timer);
  }

  return { statusCode: 200, body: 'ack' };
};
