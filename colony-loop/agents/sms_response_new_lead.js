// Signal in: SMS_RESPONSE_NEW_LEAD
// Signal out: CUSTOMER_SMS_REPLY (via the standard customer_sms_reply
// dispatcher pattern — agent composes the reply, emits the reply
// signal, customer_sms_reply.js sends the actual SMS)
//
// Purpose: when a new lead texts back to the call auto-ack SMS (which
// says "text us your appliance type + zip"), respond by pushing them
// to the website chat to complete intake. Most of these messages will
// be short and not match any keyword route — they're new prospects
// trying to get help, not existing customers asking about a job.
//
// Reply strategy: warm + brief + push to the website link. The website
// chat (with the public Ant brain) handles the real intake — Q&A,
// model photo capture, video capture, warranty-vs-self-pay routing,
// availability blackouts, all of it. SMS is just the bridge.
//
// Also: alert Danielle so she knows a new lead came in and can monitor
// or follow up if they don't complete the website intake.

import { config } from '../config.js';

const PUBLIC_SITE = (config.publicSiteBase || 'tnapplianceexchange.net').replace(/^https?:\/\//, '');

function composeReply(body) {
  const text = String(body || '').toLowerCase();
  // Lightly personalize based on the customer's wording
  let opener = "Got it — thanks for reaching out.";
  if (/fridge|refrig|freezer/.test(text)) opener = "Got it — fridge repair, perfect.";
  else if (/washer|wash machine|laundry/.test(text)) opener = "Got it — washer repair, perfect.";
  else if (/dryer/.test(text)) opener = "Got it — dryer repair, perfect.";
  else if (/dishwash/.test(text)) opener = "Got it — dishwasher repair, perfect.";
  else if (/oven|range|stove|cook/.test(text)) opener = "Got it — oven/range repair, perfect.";
  else if (/hvac|heat|air|ac\b|furnace/.test(text)) opener = "Got it — HVAC repair, perfect.";

  return `${opener} Tap here to finish setting up in about 60 seconds: ${PUBLIC_SITE} — Ant walks you through it. Or just text us back here anytime. — TN Appliance Exchange`;
}

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const p = signal.payload || {};
  const body = String(p.body || p.message || '').trim();
  const phone = p.customer_phone || p.phone || '';

  if (!phone) {
    await xano.markSignalProcessed(signal.id, 'sms_response_new_lead_handled', { outcome: 'missing_phone' });
    return { success: false, action: 'missing_phone' };
  }

  // Dedup — only send the new-lead push reply ONCE per 24h per phone.
  // If they keep texting we let the regular intent-gap fallback handle
  // them. (Set high enough that a single conversation doesn't fire it
  // twice; low enough that a returning new lead the next day gets a
  // fresh push.)
  const dedupKey = `new_lead_replied_${phone}`;
  let recent = null;
  try {
    recent = xano.findRecentEventLog
      ? await xano.findRecentEventLog(dedupKey, Date.now() - 24 * 60 * 60 * 1000)
      : null;
  } catch (_) { recent = null; }
  if (recent && recent.found) {
    await xano.markSignalProcessed(signal.id, 'sms_response_new_lead_handled', { outcome: 'skipped_recent_push' });
    return { success: true, action: 'skipped_recent_push' };
  }

  const reply = composeReply(body);

  // Emit CUSTOMER_SMS_REPLY so the standard reply dispatcher sends it.
  let emitted = null;
  try {
    emitted = await xano.emitSignal({
      signal_type: 'CUSTOMER_SMS_REPLY',
      signal_strength: 70,
      payload: {
        customer_phone: phone,
        body: reply,
        source: 'sms_response_new_lead',
        source_signal_id: signal.id,
      },
    });
  } catch (err) {
    log('new_lead_reply_emit_failed', { error: String(err.message || err) });
  }

  // Alert Danielle in parallel — new lead came in, give her the phone
  // + their first message so she can follow up if the website intake
  // doesn't complete.
  if (config.daniellePhone) {
    try {
      const aliasShort = (body || '').slice(0, 80);
      await sms.toDanielle(
        `[ant] new lead SMS from ${phone}: "${aliasShort}" — pushed to ${PUBLIC_SITE}. Watch for intake completion.`,
        { action: 'new_lead_alert_to_danielle', phone, source_signal_id: signal.id }
      );
    } catch (_) {}
  }

  const meta = {
    outcome: 'replied_with_link',
    phone,
    body_preview: (body || '').slice(0, 200),
    reply_preview: reply.slice(0, 200),
    customer_reply_signal_id: emitted && (emitted.signal_id || emitted.id) || null,
  };
  await xano.markSignalProcessed(signal.id, 'sms_response_new_lead_handled', meta);
  try {
    if (xano.recordEventLog) await xano.recordEventLog(dedupKey, meta);
  } catch (_) {}
  log('sms_response_new_lead_handled', meta);
  return { success: true, action: 'replied_with_link' };
}
