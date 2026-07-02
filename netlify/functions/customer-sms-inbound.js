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

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crud = require('./_lib/xano/metadata-crud');

const JOB_ATTACHMENTS = 22;

const XANO_RECORD_INBOUND = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/record_inbound_customer_sms';
// Phase 2d EXTRA/BLAST: try the extra-work YES/NO handler BEFORE
// the generic inbound recorder. If matched=true, the handler has
// already sent the customer's reply + booked the job (or fanned out
// to tech/loser depending on first-wins). Skip the generic flow.
const XANO_EXTRA_YES = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/process_customer_extra_yes';
const EXTRA_TIMEOUT_MS = 6000;
const XANO_TIMEOUT_MS = 9000;
const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const PUBLIC_SITE = 'tnapplianceexchange.net';

// Specific-intent keywords (mirror of the loop's KEYWORD_ROUTES). If a cold
// lead's text matches one of these, do NOT fire the instant new-lead greeting —
// let the loop route it to the right responder (cancel / reschedule / status…).
function hasSpecificIntent(body) {
  const t = String(body || '').trim();
  if (!t) return false;
  return /^\s*(M|A|MORNING|AFTERNOON|ANYTIME|EITHER|EVENING)\s*[.!]?\s*$/i.test(t)
    || /\b(reschedule|reschedul|new time|push back|move it|change the time)\b/i.test(t)
    || /\b(cancel|cancell|don't need|no longer|nevermind|never mind)\b/i.test(t)
    || /\b(part|parts|ordered|shipping|arrival)\b/i.test(t)
    || /\b(invoice|bill|charge|pay|payment|how much|cost|price)\b/i.test(t)
    || /\b(technician|tech|on the way|eta|arriving|how far)\b/i.test(t)
    || /\b(unhappy|complain|frustrat|terrible|awful|worst|refund|sue|lawyer)\b/i.test(t)
    || /\b(where(?:'?s| is) my|status|any update|update on)\b/i.test(t);
}

// Same warm new-lead reply the loop composes (sms_response_new_lead) — replicated
// so we can send it INSTANTLY inline for a cold lead, then write the loop's dedup
// marker so it doesn't re-send. Template only (no Claude) = sub-second.
function composeNewLeadReply(body) {
  const text = String(body || '').toLowerCase();
  let opener = 'Got it — thanks for reaching out.';
  if (/\b(fridge|refrigerator|refrig|freezer|ice ?maker)\b/.test(text)) opener = 'Got it — fridge repair, perfect.';
  else if (/\b(washer|washing machine|laundry)\b/.test(text)) opener = 'Got it — washer repair, perfect.';
  else if (/\b(dryer)\b/.test(text)) opener = 'Got it — dryer repair, perfect.';
  else if (/\b(dishwasher|dish ?washer)\b/.test(text)) opener = 'Got it — dishwasher repair, perfect.';
  else if (/\b(oven|range|stove|cooktop|stovetop)\b/.test(text)) opener = 'Got it — oven/range repair, perfect.';
  else if (/\b(hvac|furnace|heat ?pump|air ?condition(er|ing)?|a\/?c unit)\b/.test(text)) opener = 'Got it — HVAC repair, perfect.';
  return `${opener} Tap here to finish setting up in about 60 seconds: ${PUBLIC_SITE} — Ant walks you through it. Or just text us back here anytime. — TN Appliance Exchange`;
}

// Fire the instant inline reply for a genuinely-new lead. Bounded; best-effort.
async function instantNewLeadReply(fromPhone, body) {
  const phoneKey = String(fromPhone || '').replace(/\D/g, '');
  if (!phoneKey) return false;
  const dedupKey = 'new_lead_replied_' + phoneKey;
  // Skip if the loop (or a prior inline send) already greeted this number in 24h.
  try {
    const rc = new AbortController(); const rt = setTimeout(() => rc.abort(), 4000);
    const rr = await fetch(`${XANO_BASE}/list_recent_event_log?action=${encodeURIComponent(dedupKey)}&days_back=1&limit=3`, { signal: rc.signal });
    clearTimeout(rt);
    const rd = await rr.json().catch(() => ({}));
    if (rd && (rd.count > 0 || (Array.isArray(rd.items) && rd.items.length > 0))) return false;
  } catch (_) { /* fail open — better to greet than stay silent */ }

  const reply = composeNewLeadReply(body);
  const sc = new AbortController(); const st = setTimeout(() => sc.abort(), 6000);
  try {
    await fetch(`${XANO_BASE}/send_sms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: fromPhone, body: reply, message: reply, context_tag: 'instant_new_lead_reply' }),
      signal: sc.signal,
    });
  } catch (e) { clearTimeout(st); console.warn('[customer-sms-inbound] instant send failed', String((e && e.message) || e)); return false; }
  clearTimeout(st);
  // Write the marker the loop's new-lead agent checks, so it skips (no double-text).
  try { await crud.logEvent(dedupKey, { outcome: 'instant_inline_reply', phone: fromPhone, at_ms: Date.now() }); } catch (_) {}
  return true;
}

// Translate an inbound customer message to English (so the office can read every
// text regardless of language). Returns {is_english, lang_name, english} or null.
// Best-effort with a short timeout — never blocks the webhook ack.
async function translateToEnglish(text) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !text) return null;
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: 'You are a translation engine for an appliance-repair business. Given ONE customer text message, detect its language and translate it to natural English. Reply with ONLY compact JSON, no prose: {"is_english":boolean,"lang_name":"English|Spanish|Vietnamese|Arabic|Hindi|...","english":"the English translation (the original text if it is already English)"}.',
        messages: [{ role: 'user', content: String(text).slice(0, 1000) }],
      }),
      signal: ctl.signal,
    });
    clearTimeout(tm);
    const d = await r.json();
    const raw = (d && d.content && d.content[0] && d.content[0].text) || '';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (_) { return null; }
}

// ─── MMS media capture ──────────────────────────────────────────────
// When a customer TEXTS a photo/video (their broken appliance, the model
// sticker, a leak), it used to vanish — the webhook dropped it. Now we
// pull each Telnyx/Twilio media URL, store it to S3 server-side, and
// record a job_attachments row so it shows up everywhere the intake media
// does (office board 📎, tech-job, Teddy Tool). Best-effort + bounded so a
// slow media host never delays the webhook ack (Telnyx must not retry).
const MEDIA_FETCH_TIMEOUT_MS = 6000;

function extFor(ct) {
  const m = String(ct || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('gif')) return 'gif';
  if (m.includes('webp')) return 'webp';
  if (m.includes('heic')) return 'heic';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('quicktime') || m.includes('mov')) return 'mov';
  if (m.includes('3gpp')) return '3gp';
  return 'bin';
}

function fileTypeFor(ct) {
  const m = String(ct || '').toLowerCase();
  if (m.startsWith('image/')) return 'photo';
  if (m.startsWith('video/')) return 'video';
  return 'file';
}

async function captureOneMedia({ url, contentType, jobId, convId, fromPhone, idx }) {
  // Fetch the media bytes (Telnyx/Twilio media URLs are temporary — re-host now).
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), MEDIA_FETCH_TIMEOUT_MS);
  let buf, mime = contentType;
  try {
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(tm);
    if (!r.ok) { console.warn('[customer-sms-inbound] media fetch non-2xx', r.status, url.slice(0, 80)); return null; }
    mime = mime || r.headers.get('content-type') || 'application/octet-stream';
    const ab = await r.arrayBuffer();
    buf = Buffer.from(ab);
  } catch (e) {
    clearTimeout(tm);
    console.warn('[customer-sms-inbound] media fetch error', String((e && e.message) || e));
    return null;
  }
  if (!buf || !buf.length || buf.length > 25 * 1024 * 1024) return null;

  const ext = extFor(mime);
  const ftype = fileTypeFor(mime);
  const ts = Date.now();
  const folder = jobId ? ('jobs/' + jobId) : ('sms/' + String(fromPhone || 'anon').replace(/\D/g, ''));
  const s3Key = folder + '/sms/' + ts + '_' + idx + '.' + ext;

  try {
    const s3 = new S3Client({
      region: process.env.TN_AWS_S3_REGION,
      credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY },
    });
    await s3.send(new PutObjectCommand({ Bucket: process.env.TN_AWS_S3_BUCKET, Key: s3Key, Body: buf, ContentType: mime }));
  } catch (e) {
    console.warn('[customer-sms-inbound] media s3 store failed', String((e && e.message) || e));
    return null;
  }

  let attachmentId = null;
  try {
    const row = await crud.insert(JOB_ATTACHMENTS, {
      job_id: jobId || null,
      conversation_id: convId || null,
      attachment_type: 'intake',
      file_type: ftype,
      s3_key: s3Key,
      original_filename: 'sms_' + ftype + '.' + ext,
      mime_type: mime,
      uploaded_by: 'customer',
      uploaded_by_user_id: 0,
      upload_complete_at: ts,
      file_size_bytes: buf.length,
    });
    attachmentId = (row && (row.id || row.attachment_id)) || null;
  } catch (e) {
    console.warn('[customer-sms-inbound] media attachment insert failed', String((e && e.message) || e));
  }
  return { attachmentId, s3Key, file_type: ftype, bytes: buf.length };
}

async function captureInboundMedia({ media, jobId, convId, fromPhone }) {
  if (!Array.isArray(media) || !media.length) return [];
  const out = [];
  // Sequential (matches photo-upload's serial intake) — typically 1-2 items.
  for (let i = 0; i < media.length && i < 5; i++) {
    const m = media[i] || {};
    if (!m.url) continue;
    const res = await captureOneMedia({ url: m.url, contentType: m.content_type, jobId, convId, fromPhone, idx: i });
    if (res) out.push(res);
  }
  try {
    await crud.logEvent('customer_sms_media_captured', {
      job_id: jobId || null, from: fromPhone, count: out.length,
      keys: out.map((o) => o.s3Key), at_ms: Date.now(),
    });
  } catch (_) {}
  return out;
}

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
  const hasMedia = Array.isArray(parsed.media) && parsed.media.length > 0;
  if (!parsed.from || (!parsed.body && !hasMedia)) {
    console.warn('[customer-sms-inbound] missing from/body:', {
      provider, from_present: !!parsed.from, body_len: (parsed.body || '').length, has_media: hasMedia,
    });
    return providerAck(provider);
  }
  // A photo/video with no caption still needs a non-empty body for the recorder
  // + downstream classifier. Give it a placeholder so the job thread reads right.
  if (!parsed.body && hasMedia) parsed.body = '[photo/video]';

  console.log('[customer-sms-inbound] normalized:', {
    provider, from: parsed.from, sid: parsed.sid, to: parsed.to, body_len: parsed.body.length,
  });

  // ─── TCPA OPT-OUT / OPT-IN (must run FIRST, before any other handling) ──
  // STOP is absolute: record it, send the single legally-allowed confirmation,
  // and STOP processing (no classifier, no greeting, no booking). START re-opts.
  // sms-guard.isOptedOut() is what every outbound path now checks, so this is
  // the switch that actually turns a customer's texts off/on.
  try {
    const smsGuard = require('./_lib/sms-guard');
    if (smsGuard.isStop(parsed.body)) {
      await smsGuard.recordOptOut(parsed.from, 'sms_stop');
      // The opt-out confirmation is the ONE message allowed to a STOP'd number.
      try {
        await fetch(`${XANO_BASE}/send_sms`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: parsed.from, body: "You're unsubscribed from TN Appliance Exchange texts and won't get any more. Reply START anytime to opt back in.", message: "You're unsubscribed from TN Appliance Exchange texts and won't get any more. Reply START anytime to opt back in.", context_tag: 'opt_out_confirm' }),
        });
      } catch (_) {}
      console.log('[customer-sms-inbound] OPT-OUT recorded:', parsed.from);
      return providerAck(provider);
    }
    if (smsGuard.isStart(parsed.body)) {
      await smsGuard.clearOptOut(parsed.from, 'sms_start');
      try {
        await fetch(`${XANO_BASE}/send_sms`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: parsed.from, body: "You're re-subscribed to TN Appliance Exchange texts 🐜. Reply STOP anytime to opt out.", message: "You're re-subscribed to TN Appliance Exchange texts 🐜. Reply STOP anytime to opt out.", context_tag: 'opt_in_confirm' }),
        });
      } catch (_) {}
      console.log('[customer-sms-inbound] OPT-IN (re-subscribe):', parsed.from);
      return providerAck(provider);
    }
  } catch (e) { console.warn('[customer-sms-inbound] opt-out check threw:', e.message); }

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

  // ─── "How'd we do?" satisfaction gate ─────────────────────────────
  // If this customer was just asked 👍/👎 (or their follow-up feedback), the
  // satisfaction handler replies + alerts itself. Short-circuit on match so the
  // generic loop doesn't also auto-reply.
  try {
    const satisfaction = require('./_lib/satisfaction');
    const sr = await satisfaction.handleInbound(parsed.from, parsed.body);
    if (sr && sr.matched) {
      console.log('[customer-sms-inbound] satisfaction matched:', sr.stage);
      return providerAck(provider);
    }
  } catch (e) { console.warn('[customer-sms-inbound] satisfaction error:', e.message); }

  // Forward to Xano. Fire-and-await so we can log the signal_id, but ack
  // 200 regardless (Telnyx must not retry inbound).
  let recordData = {};
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
      recordData = await res.json().catch(() => ({}));
      console.log('[customer-sms-inbound] xano ack:', {
        signal_id: recordData.signal_id || null,
        customer_id: recordData.customer_id || 0,
        job_id: recordData.job_id || 0,
        customer_known: !!recordData.customer_known,
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

  // ⚡ INSTANT first-reply for a cold new lead (LSA / Google-chat speed-to-lead).
  // The loop's sms_response_new_lead is canonical but runs on a ~2-min tick →
  // 2-4 min wait. For a brand-new number (customer_known=false) whose message is
  // a generic intake (not a specific intent like cancel/status), send the SAME
  // reply inline in ~1s + mark it so the loop doesn't double-send. Known
  // customers + specific intents still flow through the loop with full context.
  try {
    if (recordData && recordData.customer_known === false && !hasSpecificIntent(parsed.body)) {
      const sent = await instantNewLeadReply(parsed.from, parsed.body);
      console.log('[customer-sms-inbound] instant new-lead reply:', { sent, from: parsed.from });
    }
  } catch (e) {
    console.warn('[customer-sms-inbound] instant reply error:', String((e && e.message) || e));
  }

  // Capture any texted photos/videos onto the resolved job (or by phone if the
  // recorder didn't match a job). Bounded; never blocks the ack on failure.
  if (hasMedia) {
    try {
      const saved = await captureInboundMedia({
        media: parsed.media,
        jobId: Number(recordData.job_id) || 0,
        convId: Number(recordData.conversation_id) || 0,
        fromPhone: parsed.from,
      });
      console.log('[customer-sms-inbound] media captured:', { count: saved.length, job_id: recordData.job_id || 0 });
    } catch (e) {
      console.error('[customer-sms-inbound] media capture error:', String((e && e.message) || e));
    }
  }

  // Forward a copy of every customer reply to Teddy's phone — PAUSED 2026-06-21
  // per Teddy: "Teddy Tool is the only text I need, others can be paused." These
  // replies still land in office Messages + get parsed onto the job, so nothing
  // is lost — they just stop cluttering his personal texts. Flip
  // FORWARD_CUSTOMER_REPLIES_TO_OWNER=true (env) to restore.
  if (String(process.env.FORWARD_CUSTOMER_REPLIES_TO_OWNER || '') === 'true') {
  try {
    // Translation bridge: if the customer wrote in another language, show Teddy
    // the ENGLISH (with the original underneath) so he can read every text.
    let display = String(parsed.body).slice(0, 320);
    const tx = await translateToEnglish(parsed.body);
    if (tx && tx.is_english === false && tx.english) {
      display = '🌐 [' + (tx.lang_name || 'translated') + ' → English] ' + String(tx.english).slice(0, 320)
        + '\n↳ they wrote: ' + String(parsed.body).slice(0, 200);
    }
    const note = '📨 Customer reply from ' + parsed.from + ': ' + display
      + '\n(also in office Messages)';
    const tc = new AbortController();
    const tt = setTimeout(() => tc.abort(), 4000);
    await fetch('https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: '+16154855795', body: note, message: note, context_tag: 'customer_reply_to_owner' }),
      signal: tc.signal,
    });
    clearTimeout(tt);
  } catch (_) {}
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
  const numMedia = parseInt(params.get('NumMedia') || '0', 10) || 0;
  const media = [];
  for (let i = 0; i < numMedia; i++) {
    const url = params.get('MediaUrl' + i);
    if (url) media.push({ url, content_type: params.get('MediaContentType' + i) || '' });
  }
  return {
    from: params.get('From') || '',
    body: params.get('Body') || '',
    sid:  params.get('MessageSid') || '',
    to:   params.get('To') || '',
    media,
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
  // Telnyx MMS: payload.media = [{ url, content_type, size, hash_sha256 }]
  const media = (Array.isArray(payload.media) ? payload.media : [])
    .filter((m) => m && m.url)
    .map((m) => ({ url: m.url, content_type: m.content_type || '' }));
  return {
    from: fromPhone,
    body: payload.text || '',
    sid:  payload.id || data.id || '',
    to:   toPhone,
    media,
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
