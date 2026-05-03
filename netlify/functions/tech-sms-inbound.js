// Twilio inbound SMS webhook for Ant Tech Scheduler.
// Twilio POSTs urlencoded form data here when a tech texts the company number.
// We forward to Xano, get the reply, return TwiML so Twilio sends the reply SMS.
//
// Configured in Twilio Console:
//   Phone Numbers → +16292840444 → Messaging → "A message comes in"
//   Webhook URL: https://tnapplianceexchange.net/.netlify/functions/tech-sms-inbound
//   HTTP method: POST
//
// Reuses existing Twilio env vars on Netlify:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
// (Webhook signature verification is deferred to pre-launch — see Phase 1 plan.)

const XANO_TECH_SMS_INBOUND = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:scheduling/tech_sms_inbound';

// Twilio webhook timeout is 10s. Cap Xano call at 9s to leave room for response assembly.
const XANO_TIMEOUT_MS = 9000;

// Apologetic fallback used when Xano errors or times out.
// Tech still gets a reply — we don't leave them hanging.
const FALLBACK_REPLY = "yo, my brain glitched for a sec. try that again in a min and i should be back. if it's urgent, text teddy at 615-485-5795.";

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 1. Parse Twilio's urlencoded body.
  let params;
  try {
    params = new URLSearchParams(event.body || '');
  } catch (e) {
    console.error('[tech-sms-inbound] body parse failed:', e);
    return twiml(FALLBACK_REPLY);
  }

  const from = params.get('From') || '';
  const body = params.get('Body') || '';
  const sid  = params.get('MessageSid') || '';
  const to   = params.get('To') || '';

  console.log('[tech-sms-inbound] inbound:', { from, sid, body_len: body.length, to });

  if (!from) {
    // Twilio always sends From; if missing the request is malformed.
    console.warn('[tech-sms-inbound] missing From, returning empty TwiML');
    return twiml(''); // empty response = no reply sent
  }

  // 2. Forward to Xano. Cap with abort timeout so Twilio never sees a hung request.
  let replyText;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), XANO_TIMEOUT_MS);

  try {
    const xanoRes = await fetch(XANO_TECH_SMS_INBOUND, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: from, body, sid, to }),
      signal: controller.signal
    });
    clearTimeout(timeoutHandle);

    if (!xanoRes.ok) {
      const errText = await xanoRes.text().catch(() => '');
      console.error('[tech-sms-inbound] Xano returned non-2xx:', xanoRes.status, errText.slice(0, 300));
      replyText = FALLBACK_REPLY;
    } else {
      const data = await xanoRes.json().catch(() => ({}));
      replyText = (data && typeof data.reply === 'string' && data.reply.trim())
        ? data.reply
        : FALLBACK_REPLY;
    }
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (err.name === 'AbortError') {
      console.error('[tech-sms-inbound] Xano timed out after', XANO_TIMEOUT_MS, 'ms');
    } else {
      console.error('[tech-sms-inbound] Xano fetch error:', err.message);
    }
    replyText = FALLBACK_REPLY;
  }

  console.log('[tech-sms-inbound] replying with', replyText.length, 'chars');
  return twiml(replyText);
};

// Build TwiML XML response for Twilio. Always returns 200 with valid XML —
// non-2xx responses make Twilio retry, which would duplicate fallback messages.
function twiml(replyText) {
  const safe = xmlEscape(String(replyText || ''));
  const xml = safe
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Message>${safe}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body: xml
  };
}

// Escape characters that have special meaning in XML so Ant's lowercase-with-quotes voice
// doesn't break the TwiML response shape.
function xmlEscape(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
