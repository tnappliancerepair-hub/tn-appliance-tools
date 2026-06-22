// Signal in:  SMS_RESPONSE_STATUS_INQUIRY  (routed by inbound_customer_sms.js when a
//             customer texts "where's my repair / any update / what's the status")
// Signal out: CUSTOMER_SMS_REPLY
//
// Auto-answers the most common customer text with their LIVE status — the same
// status engine the phone relays to AHS, the portal shows, and the office sees.
// The upstream classifier already skips routing entirely if the office (Danielle)
// is handling the conversation, so this never talks over a human. Dedup: at most
// one auto status reply per 2h per number.

import { config } from '../config.js';

const SITE = (config.publicSiteBase || 'https://tnapplianceexchange.net').replace(/\/+$/, '');

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const p = signal.payload || {};
  const phone = p.customer_phone || p.phone || '';
  if (!phone) { await xano.markSignalProcessed(signal.id, 'sms_response_status_inquiry_handled', { outcome: 'no_phone' }); return { success: false, action: 'no_phone' }; }
  const phoneKey = String(phone).replace(/\D/g, '');

  // dedup — one auto status reply per 2h per number
  try {
    const r = await fetch(`${config.xanoIntakeBase}/list_recent_event_log?action=status_reply_sent_${phoneKey}&days_back=1&limit=3`);
    const d = await r.json();
    const recent = ((d && d.items) || []).some((it) => Date.now() - (Number(it.created_at) || 0) < 2 * 60 * 60 * 1000);
    if (recent) { await xano.markSignalProcessed(signal.id, 'sms_response_status_inquiry_handled', { outcome: 'skipped_recent' }); return { success: true, action: 'skipped_recent' }; }
  } catch (_) {}

  // pull the live status in the customer's voice
  let reason = '', found = false;
  try {
    const r = await fetch(`${SITE}/.netlify/functions/job-status-reason?phone=${encodeURIComponent(phoneKey)}&voice=customer`);
    const d = await r.json();
    found = !!(d && d.found); reason = (d && d.reason) || '';
  } catch (_) {}

  const reply = (found && reason)
    ? 'Quick update on your repair: ' + reason + ' Anything else I can help with? — TN Appliance Exchange'
    : "Thanks for checking in! I don't see an open job on this number yet — if you have a claim or work-order number, text it and I'll pull the latest, or call 615-280-2949. — TN Appliance Exchange";

  try {
    await xano.emitSignal({
      signal_type: 'CUSTOMER_SMS_REPLY',
      signal_strength: 70,
      payload: { customer_phone: phone, body: reply, source: 'sms_response_status_inquiry', source_signal_id: signal.id },
    });
  } catch (err) { log('status_inquiry_emit_failed', { error: String(err.message || err) }); }

  try { if (xano.recordEventLog) await xano.recordEventLog(`status_reply_sent_${phoneKey}`, { phone: phoneKey, found, at_ms: Date.now() }); } catch (_) {}
  await xano.markSignalProcessed(signal.id, 'sms_response_status_inquiry_handled', { outcome: found ? 'replied_status' : 'no_job_fallback', phone: phoneKey });
  return { success: true, action: found ? 'replied_status' : 'no_job_fallback' };
}
