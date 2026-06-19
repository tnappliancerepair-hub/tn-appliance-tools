// sms_response_availability.js — parses a customer's free-text availability reply
// into AVAILABLE + UNAVAILABLE and stores both on the job via the same endpoint
// the portal uses (update_job_from_chat packs AVAIL:/UNAVAIL: into
// customer_preference_text, which every scheduling view + the route-fill read).
// Then sends a short confirmation.
//
// Routed here by inbound_customer_sms.js ONLY when this customer has a pending
// availability_requested_<job_id> and hasn't answered yet.
//
// Signal in:  SMS_RESPONSE_AVAILABILITY { job_id, customer_id, customer_phone, body }
// Signal out: CUSTOMER_SMS_REPLY (confirmation), records availability_captured_<job_id>
import { config } from '../config.js';

const PARSER_PROMPT =
  'You are a scheduler for an appliance-repair company. The customer was asked when they ARE and ARE NOT available for a repair visit. ' +
  'From their message, extract two short, human-readable strings:\n' +
  '- "available": the days/times they CAN do (e.g. "weekday mornings", "Tue or Thu after 2pm", "anytime").\n' +
  '- "unavailable": the days/times they CANNOT do (e.g. "not Fridays", "no mornings", "not next week").\n' +
  'Return ONLY a compact JSON object: {"available":"...","unavailable":"..."} . Use an empty string when not stated. No commentary, no markdown.';

export async function run(signal, ctx) {
  const { xano, claude, log } = ctx;
  const p = signal.payload || {};
  const jobId = p.job_id == null ? null : Number(p.job_id);
  const phone = String(p.customer_phone || p.phone || '').trim();
  const body = String(p.body || p.message || '').trim();

  if (!jobId || !body) {
    const meta = { job_id: jobId, outcome: 'missing_job_or_body' };
    await xano.markSignalProcessed(signal.id, 'availability_parsed', meta);
    return { success: false, action: 'missing_job_or_body' };
  }

  // Parse with Claude → {available, unavailable}. On any failure, fall back to
  // storing the raw reply as availability so the customer's input is never lost.
  let available = '', unavailable = '';
  try {
    const resp = await claude.callClaude({
      system: PARSER_PROMPT,
      messages: [{ role: 'user', content: body }],
      model: config.claudeModel,
    });
    let raw = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();
    raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(raw);
    available = String(parsed.available || '').trim();
    unavailable = String(parsed.unavailable || '').trim();
  } catch (err) {
    available = body.slice(0, 200);
    log('availability_parse_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // Write via the portal's own endpoint (handles the AVAIL:/UNAVAIL: packing).
  const last4 = phone.replace(/\D/g, '').slice(-4);
  let writeOk = false;
  try {
    const w = await xano.updateJobFromChat({
      job_id: jobId,
      phone_last4: last4,
      customer_preference_text: available,
      customer_unavailability_text: unavailable,
    });
    writeOk = !!(w && (w.success || w.id || w.job_id || w.updated));
  } catch (err) {
    log('availability_write_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // Stop the inbound router from treating further replies as availability.
  try {
    await xano.recordEvent(`availability_captured_${jobId}`, {
      job_id: jobId, available, unavailable, write_ok: writeOk, at_ms: Date.now(),
    });
  } catch (_) {}

  // Confirm to the customer.
  await xano.emitSignal({
    signal_type: 'CUSTOMER_SMS_REPLY',
    signal_strength: 55,
    payload: {
      job_id: jobId,
      customer_id: p.customer_id || null,
      customer_phone: phone || null,
      sms_type: 'availability_confirmation',
      reply_text: "Got it — thank you! We'll work around that and text you to confirm your day.",
      generated_by: 'sms_response_availability',
      source_signal_id: signal.id,
      generated_at_ms: Date.now(),
    },
  });

  const meta = { job_id: jobId, outcome: 'parsed', available, unavailable, write: writeOk ? 'ok' : 'failed' };
  await xano.markSignalProcessed(signal.id, 'availability_parsed', meta);
  log('availability_parsed', meta);
  return { success: true, action: 'parsed', job_id: jobId };
}
