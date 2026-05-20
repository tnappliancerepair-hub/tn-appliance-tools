// Tech-side inbound SMS webhook for Ant Tech Scheduler.
// Refactored 2026-05-20: dual-format (Twilio + Telnyx) auto-detection.
//
// ─── Why dual format ───────────────────────────────────────────────
// Original: Twilio-only (urlencoded body, From/Body/MessageSid fields,
// TwiML reply XML returned inline).
// Now: Telnyx is primary inbound (per docs/sms-architecture-2026-05-19.md).
// Telnyx posts JSON with `data.payload.from.phone_number` / `data.payload.text`
// and CANNOT reply inline — replies must be sent via a separate POST to
// our existing /send_sms Xano endpoint (which itself routes via Telnyx).
// We keep the Twilio path live for failover (Twilio number +17273508487
// stays active for inbound per architecture doc section 8).
//
// ─── Format detection rules ────────────────────────────────────────
//   1. Content-Type starts with "application/json"   -> Telnyx
//   2. Content-Type starts with "application/x-www-form-urlencoded" -> Twilio
//   3. Else: peek body, "{" start -> Telnyx, else Twilio (defensive)
//
// ─── Telnyx event types ────────────────────────────────────────────
// Telnyx fires this webhook for THREE event types:
//   message.received   -> a real inbound text from a tech; forward to Xano
//   message.sent       -> our outbound was accepted by carrier (ack only)
//   message.finalized  -> outbound delivery receipt (ack only)
// We MUST ignore the non-received events or every outbound we send would
// trigger a phantom inbound flow.
//
// ─── Webhook URLs to configure ─────────────────────────────────────
// Telnyx portal -> Messaging Profile 40019e28-9488-4a86-aef9-764f7a8b2891
//   Inbound Settings -> Webhook URL:
//     https://tnapplianceexchange.net/.netlify/functions/tech-sms-inbound
//   Webhook API Version: 2 (JSON, ed25519 signature)
//   Failover URL: (optional, same URL or blank)
//
// Twilio Console -> Phone Numbers -> the tech inbound number ->
//   Messaging -> "A message comes in" -> Webhook URL:
//     https://tnapplianceexchange.net/.netlify/functions/tech-sms-inbound
//   HTTP method: POST
//
// ─── Signature verification ────────────────────────────────────────
// Deferred to pre-launch hardening (matches the prior Twilio-only file's
// deferred-to-pre-launch posture). When implemented:
//   Telnyx -> verify Telnyx-Signature-Ed25519-Signature header against
//     the public key from the messaging profile.
//   Twilio -> verify X-Twilio-Signature against TWILIO_AUTH_TOKEN.
// See docs/sms-architecture-2026-05-19.md section 6.

const XANO_TECH_SMS_INBOUND = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:scheduling/tech_sms_inbound';
const XANO_SEND_SMS         = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms';

// Xano call timeout. Twilio webhook timeout is ~10s; Telnyx is ~30s. Cap at 9s
// to leave room for assembly + (Telnyx path) the follow-up send_sms call.
const XANO_TIMEOUT_MS = 9000;
const SEND_SMS_TIMEOUT_MS = 7000;

const FALLBACK_REPLY = "yo, my brain glitched for a sec. try that again in a min and i should be back. if it's urgent, text teddy at 615-485-5795.";

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 1. Detect provider.
  const provider = detectProvider(event);
  console.log('[tech-sms-inbound] provider =', provider);

  // 2. Parse + normalize. Returns null when this is an event we should ignore
  //    (Telnyx delivery receipts, malformed payload, etc.) — in which case
  //    we ack-200 and stop.
  let parsed;
  try {
    parsed = provider === 'telnyx' ? parseTelnyx(event) : parseTwilio(event);
  } catch (e) {
    console.error('[tech-sms-inbound] parse threw:', e.message);
    return providerAck(provider, '');
  }

  if (!parsed) {
    // Ignored-event path (e.g. Telnyx message.sent / message.finalized).
    return providerAck(provider, '');
  }

  if (!parsed.from || !parsed.body) {
    console.warn('[tech-sms-inbound] missing from or body after parse:', {
      provider, from_present: !!parsed.from, body_len: (parsed.body || '').length,
    });
    return providerAck(provider, '');
  }

  console.log('[tech-sms-inbound] normalized:', {
    provider, from: parsed.from, sid: parsed.sid, to: parsed.to, body_len: parsed.body.length,
  });

  // 3. Forward to brain (v2) or legacy Xano endpoint (v1).
  //
  // 2026-05-20: feature-flag dispatch. The legacy Xano `tech_sms_inbound`
  // endpoint is broken (unresolved-references corruption — see
  // docs/xano-deploy-corruption-explained-2026-05-20.md). The v2 brain
  // lives in _lib/brain/onboarding.js and talks directly to the Xano
  // Metadata API.
  //
  // Flag semantics:
  //   TECH_SMS_BRAIN_V2          "true"  -> v2 enabled
  //   TECH_SMS_BRAIN_V2_PHONES   csv of bare-10-digit phones to restrict
  //                              v2 to. Empty = all phones.
  // Daily-mode techs (tech.onboarding_completed_at set) get { fallthrough: true }
  // from the brain and we route them to the legacy path here.
  const v2Enabled = process.env.TECH_SMS_BRAIN_V2 === 'true';
  const v2Phones = (process.env.TECH_SMS_BRAIN_V2_PHONES || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const bareDigits = (parsed.from || '').replace(/\D/g, '').slice(-10);
  const useBrain = v2Enabled && (v2Phones.length === 0 || v2Phones.includes(bareDigits));

  let replyText;
  if (useBrain) {
    try {
      const { runOnboardingTurn } = require('./_lib/brain/onboarding');
      // Brain expects { phone, body, sid, to } (matches the legacy Xano
      // endpoint input contract). Twilio/Telnyx parsing produces `from`
      // — remap here so the brain doesn't see undefined phone.
      const r = await runOnboardingTurn({
        phone: parsed.from,
        body:  parsed.body,
        sid:   parsed.sid,
        to:    parsed.to,
      });
      if (r && r.fallthrough) {
        console.log('[tech-sms-inbound] v2 brain fell through (daily-mode tech), routing to legacy');
        replyText = await fetchAntReply(parsed);
      } else {
        replyText = (r && r.reply) || FALLBACK_REPLY;
        console.log('[tech-sms-inbound] v2 brain replied, length:', replyText.length);
      }
    } catch (e) {
      console.error('[tech-sms-inbound] v2 brain threw, falling back to legacy:', e.message);
      replyText = await fetchAntReply(parsed);
    }
  } else {
    replyText = await fetchAntReply(parsed);
  }

  console.log('[tech-sms-inbound] reply length:', replyText.length, 'provider:', provider);

  // 4. Provider-specific delivery of the reply.
  if (provider === 'telnyx') {
    // Telnyx: send the reply via send_sms (separate API call) and ack the webhook.
    // Fire-and-await so we know the send result; even on send failure we still
    // ack 200 so Telnyx doesn't retry the inbound webhook.
    await sendTelnyxReply(parsed.from, replyText);
    return { statusCode: 200, body: '' };
  }

  // Twilio: reply inline via TwiML.
  return twiml(replyText);
};

// ─── PROVIDER DETECTION ───────────────────────────────────────────────
function detectProvider(event) {
  const ct = (
    (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || ''
  ).toLowerCase();

  if (ct.startsWith('application/json')) return 'telnyx';
  if (ct.startsWith('application/x-www-form-urlencoded')) return 'twilio';

  // Defensive: peek the body.
  const body = (event.body || '').trim();
  if (body.startsWith('{')) return 'telnyx';
  return 'twilio';
}

// ─── TWILIO PARSER ────────────────────────────────────────────────────
// Returns { from, body, sid, to } or null when malformed.
function parseTwilio(event) {
  const params = new URLSearchParams(event.body || '');
  return {
    from: params.get('From') || '',
    body: params.get('Body') || '',
    sid:  params.get('MessageSid') || '',
    to:   params.get('To') || '',
  };
}

// ─── TELNYX PARSER ────────────────────────────────────────────────────
// Telnyx webhook v2 shape:
// { data: { event_type, id, occurred_at, payload: { from: { phone_number },
//   to: [{ phone_number }], text, id, ... } } }
// Returns null for events we should ignore (sent / finalized / unknown).
function parseTelnyx(event) {
  let parsed;
  try {
    parsed = JSON.parse(event.body || '{}');
  } catch (e) {
    console.warn('[tech-sms-inbound] telnyx JSON parse failed:', e.message);
    return null;
  }

  const data = (parsed && parsed.data) || {};
  const eventType = data.event_type || '';

  if (eventType !== 'message.received') {
    // message.sent / message.finalized / anything else: ack-only.
    console.log('[tech-sms-inbound] telnyx ignored event_type:', eventType);
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

// ─── FORWARD TO XANO ──────────────────────────────────────────────────
async function fetchAntReply(parsed) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), XANO_TIMEOUT_MS);
  try {
    const res = await fetch(XANO_TECH_SMS_INBOUND, {
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
      console.error('[tech-sms-inbound] Xano returned non-2xx:', res.status, errText.slice(0, 300));
      return FALLBACK_REPLY;
    }
    const data = await res.json().catch(() => ({}));
    if (data && typeof data.reply === 'string' && data.reply.trim()) {
      return data.reply;
    }
    return FALLBACK_REPLY;
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (err.name === 'AbortError') {
      console.error('[tech-sms-inbound] Xano timed out after', XANO_TIMEOUT_MS, 'ms');
    } else {
      console.error('[tech-sms-inbound] Xano fetch error:', err.message);
    }
    return FALLBACK_REPLY;
  }
}

// ─── TELNYX REPLY VIA send_sms ────────────────────────────────────────
async function sendTelnyxReply(toPhone, text) {
  if (!toPhone || !text) return;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), SEND_SMS_TIMEOUT_MS);
  try {
    const res = await fetch(XANO_SEND_SMS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to:          toPhone,
        message:     text,
        context_tag: 'tech_sms_inbound_reply',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutHandle);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[tech-sms-inbound] send_sms reply non-2xx:', res.status, errText.slice(0, 300));
      return;
    }
    const data = await res.json().catch(() => ({}));
    console.log('[tech-sms-inbound] send_sms reply ok:', {
      provider_message_id: data.provider_message_id || null,
      success: data.success,
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (err.name === 'AbortError') {
      console.error('[tech-sms-inbound] send_sms reply timed out');
    } else {
      console.error('[tech-sms-inbound] send_sms reply error:', err.message);
    }
  }
}

// ─── PROVIDER ACK ─────────────────────────────────────────────────────
// Used on ignored/malformed events so we don't trigger provider retries.
function providerAck(provider, replyText) {
  if (provider === 'telnyx') {
    return { statusCode: 200, body: '' };
  }
  return twiml(replyText || '');
}

// ─── TwiML BUILDER (Twilio path) ──────────────────────────────────────
function twiml(replyText) {
  const safe = xmlEscape(String(replyText || ''));
  const xml = safe
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Message>${safe}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body: xml,
  };
}

function xmlEscape(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
