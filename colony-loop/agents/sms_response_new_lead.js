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
  // Lightly personalize based on the customer's wording. Word-boundaried + specific
  // terms only — bare "air"/"heat"/"ac" substring-matched everyday words ("fairly"
  // → HVAC; Heather, 2026-06-25). When nothing clearly matches, stay neutral — a
  // wrong appliance label reads worse than none.
  let opener = "Got it — thanks for reaching out.";
  if (/\b(fridge|refrigerator|refrig|freezer|ice ?maker)\b/.test(text)) opener = "Got it — fridge repair, perfect.";
  else if (/\b(washer|washing machine|laundry)\b/.test(text)) opener = "Got it — washer repair, perfect.";
  else if (/\b(dryer)\b/.test(text)) opener = "Got it — dryer repair, perfect.";
  else if (/\b(dishwasher|dish ?washer)\b/.test(text)) opener = "Got it — dishwasher repair, perfect.";
  else if (/\b(oven|range|stove|cooktop|stovetop)\b/.test(text)) opener = "Got it — oven/range repair, perfect.";
  else if (/\b(hvac|furnace|heat ?pump|air ?condition(er|ing)?|a\/?c unit)\b/.test(text)) opener = "Got it — HVAC repair, perfect.";

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

  // KNOWN-CUSTOMER GUARD (Teddy 2026-07-07: "anything else is incorrect for warranty
  // customers"). A reply from a phone that already has a live job is NOT a new lead —
  // it's a warranty/existing customer answering the intake or availability text. Firing
  // the new-lead "finish setting up" push at them is exactly the duplicate that piled
  // onto Jen Ross's thread. If the number maps to any non-terminal job, stay out of it
  // (the greeting + availability_request already own their intake — capped at 2).
  try {
    const pk = String(phone).replace(/\D/g, '').slice(-10);
    const r = await fetch(`${config.xanoIntakeBase}/office_universal_search?q=${encodeURIComponent(pk)}`);
    const d = await r.json();
    const live = (d && d.items || []).some((it) => {
      const s = String(it.scheduling_status || '').toLowerCase();
      return s && !/cancel|complet/.test(s);
    });
    if (live) {
      await xano.markSignalProcessed(signal.id, 'sms_response_new_lead_handled', { outcome: 'skipped_known_customer' });
      log('sms_response_new_lead_handled', { outcome: 'skipped_known_customer', phone: pk.slice(-4) });
      return { success: true, action: 'skipped_known_customer' };
    }
  } catch (_) { /* fail open — dedup + reply are still bounded */ }

  // Dedup — send the new-lead push reply ONCE per 24h per phone. The old
  // findRecentEventLog path was a no-op (it never found the marker), so this
  // re-fired on EVERY reply and spammed the customer the same text (Danielle,
  // 2026-06-22). Now we read event_log directly + reliably.
  const phoneKey = String(phone).replace(/\D/g, '');
  const dedupKey = `new_lead_replied_${phoneKey}`;
  let alreadyPushed = false;
  try {
    const r = await fetch(`${config.xanoIntakeBase}/list_recent_event_log?action=${encodeURIComponent(dedupKey)}&days_back=1&limit=5`);
    const d = await r.json();
    alreadyPushed = !!(d && (d.count > 0 || (Array.isArray(d.items) && d.items.length > 0)));
  } catch (_) { alreadyPushed = false; }
  if (alreadyPushed) {
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
