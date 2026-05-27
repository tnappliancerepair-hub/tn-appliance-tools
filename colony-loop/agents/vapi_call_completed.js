// Handles VAPI_CALL_COMPLETED signals (emitted by record_vapi_call). For
// each completed inbound voice call:
//   - SMSes Teddy + Danielle the caller + transcript summary
//   - If transcript indicates booking intent, emits a JOB_FROM_VAPI signal
//     for a future intake agent (placeholder for v2)
//
// Quiet hours skip — after-hours calls still get a webhook + SMS so
// office sees what happened.
import { config } from '../config.js';
import { toOwner, toDanielle } from '../sms.js';

function bareDomain() { return (config.publicSiteBase || '').replace(/^https?:\/\//, ''); }

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const caller = String(payload.caller_number || '').trim();
  const calledNum = String(payload.called_number || '').trim();
  const callId = String(payload.vapi_call_id || '').trim();
  const transcript = String(payload.transcript || '').trim();
  const summary = String(payload.summary || '').trim();

  if (!caller) {
    await xano.markSignalProcessed(signal.id, 'vapi_call_completed_handled', { outcome: 'skipped_missing_caller' });
    return { success: false, action: 'skipped_missing_caller' };
  }

  const domain = bareDomain();
  const searchUrl = `${domain}/customer-search.html?phone=${encodeURIComponent(caller)}`;
  const summaryClause = summary ? ` Summary: "${summary.slice(0, 200)}"` : '';
  const callIdClause = callId ? ` Call: ${callId.slice(0, 16)}` : '';

  const body =
    `[ant] 🤖 Vapi call from ${caller} on ${calledNum || 'vanity'}.${summaryClause}${callIdClause} ` +
    `Pull up: ${searchUrl}`;

  let teddyRes = null, danielleRes = null;
  try { teddyRes = await toOwner(body, { action: 'vapi_call_alert_owner', vapi_call_id: callId, caller, source_signal_id: signal.id }); }
  catch (err) { teddyRes = { success: false, error: String(err.message || err) }; }
  try { danielleRes = await toDanielle(body, { action: 'vapi_call_alert_danielle', vapi_call_id: callId, caller, source_signal_id: signal.id }); }
  catch (err) { danielleRes = { success: false, error: String(err.message || err) }; }

  // Crude booking-intent detection — keywords in transcript/summary
  const text = `${transcript} ${summary}`.toLowerCase();
  const wantsBooking = /\b(schedule|book|appointment|repair|fix|broken|not working)\b/.test(text);

  if (wantsBooking) {
    try {
      await xano.emitSignal({
        signal_type: 'JOB_FROM_VAPI',
        signal_strength: 70,
        payload: {
          caller_number: caller,
          vapi_call_id: callId,
          transcript: transcript.slice(0, 1500),
          summary: summary.slice(0, 300),
          source_signal_id: signal.id,
        },
      });
    } catch (err) {
      log('vapi_job_from_vapi_emit_failed', { call_id: callId, error: String(err.message || err) });
    }
  }

  const meta = {
    vapi_call_id: callId,
    caller,
    outcome: 'alerted',
    wants_booking: wantsBooking,
    teddy_sms: teddyRes && teddyRes.success ? 'ok' : 'maybe_failed',
    danielle_sms: danielleRes && danielleRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'vapi_call_completed_handled', meta);
  log('vapi_call_completed_handled', meta);
  return { success: true, action: 'alerted', ...meta };
}
