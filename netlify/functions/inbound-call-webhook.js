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
const XANO_TIMEOUT_MS = 9000;

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
