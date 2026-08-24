// telnyx-call-webhook — the Telnyx-native equivalent of vapi-webhook's end-of-call
// safety net, for when Telnyx Ann takes over (Teddy 2026-08-15, cutover).
//
// Point this URL at the Telnyx AI Assistant's webhook — it's INSIDE the assistant
// editor (AI Assistants -> open the Ann assistant -> its Insights/Webhook setting),
// NOT the global "AI Suite -> Insights" list (that page only defines insights).
// It fires after each conversation, so it catches connected-then-dropped calls
// (enough to auto-verify the payload + graduate the rescue). A caller who never
// connects at all won't generate one -- that gap is covered by phone-drop-watch's
// server-side polling, not this webhook. Can also be set via the Telnyx API
// (PATCH /ai/assistants/{id}) instead of the portal.
//
// WHAT IT DOES — two jobs, split by risk so nothing fires blind:
//   1. ALWAYS logs every call event raw to event_log (`telnyx_call_event`) so we
//      can SEE Telnyx's real payload shape and never lose a record. Zero risk.
//   2. Classifies a DROPPED / never-connected inbound call and records
//      `telnyx_call_dropped` (this is what the drop-cluster watchdog counts —
//      detection is safe, it only alerts Teddy).
//   3. AUTO-RESCUE (the part that CALLS a customer back) is gated behind
//      TELNYX_CALL_RESCUE_LIVE=true, DEFAULT OFF. Until we confirm the real
//      payload field names from one live call, it stays off so we never fire a
//      false callback. Flip it on once verified. AHS-aware when live (warranty
//      caller → office alert, no futile callback; homeowner → 60s callback).
//
// Always returns 200 so Telnyx never retries.
'use strict';

const { getSecretPreferVault } = require('./_lib/secrets');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';
const DANIELLE = '+16154850713';
const B2B_PREFIXES = ['+1888', '+1800', '+1866', '+1877', '+1855', '+1844', '+1833'];
const INTERNAL = new Set(['6154855795', '6154850713', '6159671304', '5049099413', '6158291654', '8133527686', '6292594602']);

function last10(p) { return String(p || '').replace(/\D/g, '').slice(-10); }
function isInternal(p) { return INTERNAL.has(last10(p)); }
async function safePost(path, body) {
  try { await fetch(`${XANO}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }); } catch (_) {}
}
// Defensive field probing — Telnyx's exact payload shape is confirmed off the
// first real call (raw is logged below); until then we look in every plausible spot.
function pick(obj, paths) {
  for (const p of paths) {
    let v = obj; let ok = true;
    for (const k of p.split('.')) { if (v && typeof v === 'object' && k in v) v = v[k]; else { ok = false; break; } }
    if (ok && v != null && v !== '') return v;
  }
  return '';
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 200, body: 'ok' };
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const data = body.data || body;
  const payload = data.payload || data || {};

  const eventType = String(pick(body, ['data.event_type', 'data.record_type', 'event_type', 'type']) || pick(payload, ['event_type', 'type']) || '').toLowerCase();
  const from = String(pick(payload, ['from', 'from.phone_number', 'caller', 'caller_number', 'telephony.from', 'call.from', 'metadata.from', 'customer.number']) || pick(data, ['from', 'caller']) || '');
  const to = String(pick(payload, ['to', 'to.phone_number', 'called_number', 'telephony.to', 'call.to']) || '');
  const direction = String(pick(payload, ['direction', 'call.direction', 'telephony.direction']) || '').toLowerCase();
  const hangup = String(pick(payload, ['hangup_cause', 'hangup_source', 'end_reason', 'ended_reason', 'status', 'call.hangup_cause', 'outcome']) || '').toLowerCase();
  const durRaw = pick(payload, ['call_duration_secs', 'duration_secs', 'duration', 'call.duration', 'conversation.duration_secs']);
  const durSec = Number(durRaw) || 0;
  const hasConversation = !!(pick(payload, ['conversation', 'conversation_id', 'transcript', 'insights', 'summary']) || pick(data, ['conversation', 'summary']));

  // 1. ALWAYS log raw (truncated) so we learn the exact shape + keep a record.
  await safePost('record_event_log', {
    action: 'telnyx_call_event',
    metadata_json: JSON.stringify({
      event_type: eventType, from, to, direction, hangup, dur_sec: durSec,
      has_conversation: hasConversation, top_keys: Object.keys(body || {}).slice(0, 12),
      payload_keys: Object.keys(payload || {}).slice(0, 20), raw: JSON.stringify(body).slice(0, 1500), at_ms: Date.now(),
    }),
  });

  // 2. Classify a DROPPED / never-connected INBOUND call. Conservative: an inbound
  //    call that ended with NO conversation and either zero duration or a non-normal
  //    hangup cause. A normal completed AI conversation is NOT a drop.
  const inbound = direction ? /in/.test(direction) : true;   // default inbound if unknown
  const badHangup = /reject|no.?answer|no_answer|timeout|fail|busy|unallocated|not.?connected|transport|error|cancel/.test(hangup);
  const endedish = /ended|hangup|failed|completed|call\.hangup|call\.ended|no.?answer/.test(eventType);
  const looksDropped = inbound && !hasConversation && endedish && (durSec <= 3 || badHangup) && !!from && !isInternal(from);

  if (!looksDropped) return { statusCode: 200, body: JSON.stringify({ ok: true, logged: true, dropped: false }) };

  // It reads as a dropped inbound. Record it so the drop-cluster watchdog counts it
  // (detection is safe — alert-only). Rescue (calling the customer back) is gated.
  const isB2b = B2B_PREFIXES.some((p) => String(from).startsWith(p));
  await safePost('record_event_log', {
    action: 'telnyx_call_dropped',
    metadata_json: JSON.stringify({ from, hangup, dur_sec: durSec, event_type: eventType, is_b2b: isB2b, at_ms: Date.now() }),
  });

  // Read the flag from the vault FIRST (telnyx-cutover-watch auto-flips it there once
  // it has verified the rescue against real call payloads), env as fallback. This is
  // what makes the graduation hands-off — no redeploy, no manual env edit.
  let rescueFlag = '';
  try { rescueFlag = await getSecretPreferVault('TELNYX_CALL_RESCUE_LIVE'); } catch (_) {}
  const rescueLive = String(rescueFlag || 'false').toLowerCase() === 'true';
  if (!rescueLive) {
    // Shadow: net is capturing + detecting, but we don't call anyone back until the
    // real payload shape is confirmed from a live call. No false callbacks.
    return { statusCode: 200, body: JSON.stringify({ ok: true, logged: true, dropped: true, rescue: 'shadow' }) };
  }

  // LIVE rescue (mirrors vapi-webhook): AHS/warranty caller → office "keep the line
  // clear" alert (a callback to their call center is futile); homeowner → 60s auto-
  // callback + Teddy alert.
  if (isB2b) {
    await safePost('send_sms', { to_number: DANIELLE, message: `[ant] ⚠️ A warranty/AHS call dropped before connecting on the new line (${from} · ${hangup || 'no reason'}). They'll likely redial — keep the line clear.`, recipient_role: 'warranty_handler', context: { source: 'telnyx_ahs_drop_alert' } });
  } else {
    await safePost('emit_colony_signal', {
      signal_type: 'MISSED_CALL_CALLBACK_DUE', signal_strength: 95,
      payload_json: JSON.stringify({ caller_phone: from, called_phone: to, ended_reason: hangup || 'telnyx_drop', deadline_ms: Date.now() + 60 * 1000, duration_sec: durSec, is_transport_drop: true, opening_hint: "Hi, this is Ann with Tennessee Appliance calling you right back — looks like your call didn't come through a moment ago. How can I help?" }),
    });
    await safePost('send_sms', { to_number: OWNER, message: `[ant] a call never connected on the new Telnyx line (${from}). Auto-callback firing in 60 sec.`, recipient_role: 'owner', context: { source: 'telnyx_drop_alert' } });
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, logged: true, dropped: true, rescue: isB2b ? 'office_alert' : 'callback' }) };
};
