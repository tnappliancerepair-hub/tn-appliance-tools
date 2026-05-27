// Customer-direction inbound SMS webhook for Ant.
//
// Mirror of netlify/functions/tech-sms-inbound.js, but pointed at the
// customer-direction Telnyx number (+1 615-588-9500) and forwarding to the
// new Xano endpoint `record_inbound_customer_sms`, which emits the
// INBOUND_CUSTOMER_SMS colony signal.
//
// Unlike the tech path, this function does NOT reply inline. The colony
// loop's inbound_customer_sms agent classifies intent and the appropriate
// sms_response_* agent generates the reply text. customer_sms_reply then
// ships it via Xano's send_sms (Telnyx). End-to-end latency is the loop
// tick interval (typically <60s) plus the agent's Claude call.
//
// ─── Webhook URLs to configure ─────────────────────────────────────
// Telnyx portal -> Messaging Profile for +1 615-588-9500
//   Inbound Settings -> Webhook URL:
//     https://tnapplianceexchange.net/.netlify/functions/customer-sms-inbound
//   Webhook API Version: 2 (JSON)
// Twilio path is currently not wired for customer direction; if it ever is,
// this function's dual-format detection (copied from the tech path) will
// handle it automatically.

const XANO_RECORD_INBOUND = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/record_inbound_customer_sms';
// Phase 2d EXTRA/BLAST: try the extra-work YES/NO handler BEFORE
// the generic inbound recorder. If matched=true, the handler has
// already sent the customer's reply + booked the job (or fanned out
// to tech/loser depending on first-wins). Skip the generic flow.
const XANO_EXTRA_YES = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/process_customer_extra_yes';
const EXTRA_TIMEOUT_MS = 6000;
const XANO_TIMEOUT_MS = 9000;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const provider = detectProvider(event);
  console.log('[customer-sms-inbound] provider =', provider);

  let parsed;
  try {
    parsed = provider === 'telnyx' ? parseTelnyx(event) : parseTwilio(event);
  } catch (e) {
    console.error('[customer-sms-inbound] parse threw:', e.message);
    return providerAck(provider);
  }

  if (!parsed) return providerAck(provider);
  if (!parsed.from || !parsed.body) {
    console.warn('[customer-sms-inbound] missing from/body:', {
      provider, from_present: !!parsed.from, body_len: (parsed.body || '').length,
    });
    return providerAck(provider);
  }

  console.log('[customer-sms-inbound] normalized:', {
    provider, from: parsed.from, sid: parsed.sid, to: parsed.to, body_len: parsed.body.length,
  });

  // ─── EXTRA/BLAST YES/NO interceptor (Phase 2d) ─────────────────────
  // Check if this is a response to an active extra-work offer. If so,
  // the handler sends the customer reply itself + books/loser-routes
  // synchronously. Return early — skip the generic recorder.
  try {
    const extraCtl = new AbortController();
    const extraTimer = setTimeout(() => extraCtl.abort(), EXTRA_TIMEOUT_MS);
    const extraRes = await fetch(XANO_EXTRA_YES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: parsed.from, body: parsed.body }),
      signal: extraCtl.signal,
    });
    clearTimeout(extraTimer);
    if (extraRes.ok) {
      const extraData = await extraRes.json().catch(() => ({}));
      if (extraData && extraData.matched) {
        console.log('[customer-sms-inbound] extra_yes matched:', extraData.action);
        return providerAck(provider);
      }
    } else {
      console.warn('[customer-sms-inbound] extra_yes non-2xx:', extraRes.status);
    }
  } catch (e) {
    if (e.name === 'AbortError') console.warn('[customer-sms-inbound] extra_yes timed out');
    else console.warn('[customer-sms-inbound] extra_yes error:', e.message);
  }

  // Forward to Xano. Fire-and-await so we can log the signal_id, but ack
  // 200 regardless (Telnyx must not retry inbound).
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), XANO_TIMEOUT_MS);
  try {
    const res = await fetch(XANO_RECORD_INBOUND, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: parsed.from,
        body:  parsed.body,
        sid:   parsed.sid,
        to:    parsed.to,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutHandle);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[customer-sms-inbound] Xano non-2xx:', res.status, errText.slice(0, 300));
    } else {
      const data = await res.json().catch(() => ({}));
      console.log('[customer-sms-inbound] xano ack:', {
        signal_id: data.signal_id || null,
        customer_id: data.customer_id || 0,
        job_id: data.job_id || 0,
        customer_known: !!data.customer_known,
      });
    }
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (err.name === 'AbortError') {
      console.error('[customer-sms-inbound] Xano timed out');
    } else {
      console.error('[customer-sms-inbound] Xano fetch error:', err.message);
    }
  }

  return providerAck(provider);
};

function detectProvider(event) {
  const ct = (
    (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || ''
  ).toLowerCase();
  if (ct.startsWith('application/json')) return 'telnyx';
  if (ct.startsWith('application/x-www-form-urlencoded')) return 'twilio';
  const body = (event.body || '').trim();
  return body.startsWith('{') ? 'telnyx' : 'twilio';
}

function parseTwilio(event) {
  const params = new URLSearchParams(event.body || '');
  return {
    from: params.get('From') || '',
    body: params.get('Body') || '',
    sid:  params.get('MessageSid') || '',
    to:   params.get('To') || '',
  };
}

function parseTelnyx(event) {
  let parsed;
  try { parsed = JSON.parse(event.body || '{}'); }
  catch (e) {
    console.warn('[customer-sms-inbound] telnyx JSON parse failed:', e.message);
    return null;
  }
  const data = (parsed && parsed.data) || {};
  const eventType = data.event_type || '';
  if (eventType !== 'message.received') {
    console.log('[customer-sms-inbound] telnyx ignored event_type:', eventType);
    return null;
  }
  const payload = data.payload || {};
  const fromPhone = (payload.from && payload.from.phone_number) || '';
  const toArr = Array.isArray(payload.to) ? payload.to : [];
  const toPhone = (toArr[0] && toArr[0].phone_number) || '';
  return {
    from: fromPhone,
    body: payload.text || '',
    sid:  payload.id || data.id || '',
    to:   toPhone,
  };
}

function providerAck(provider) {
  if (provider === 'telnyx') return { statusCode: 200, body: '' };
  // Twilio path: empty TwiML so no auto-reply (reply happens via colony loop).
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body: '<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>',
  };
}
