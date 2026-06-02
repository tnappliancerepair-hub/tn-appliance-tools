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
const XANO_TIMEOUT_MS = 9000;

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

  console.log('[inbound-call-webhook] inbound from', from, 'callId', callId);

  // FIRE-AND-FORGET customer auto-ack via emergency endpoint (dedup'd 6h)
  fireCustomerAutoAck(from);

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
