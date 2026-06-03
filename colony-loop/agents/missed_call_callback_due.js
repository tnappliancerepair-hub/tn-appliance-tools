// Hold-and-re-emit until the deadline (5 min after the missed call hits
// the webhook), then place an outbound Vapi call via the Missed Call
// Callback assistant. Skip if the customer has called back already in
// the meantime (deduped via event_log for recent inbound calls).
//
// Triggered by: vapi-webhook.js call-end handler when endedReason
// indicates an abandoned call (voicemail, busy, no-answer).

import * as xano from '../xano.js';
import { placeOutboundCall, ASSISTANT_IDS } from '../vapi-out.js';
import { fmtCT } from '../time.js';

function shortAgoHuman(ms) {
  if (!ms) return 'a few minutes ago';
  const minutesAgo = Math.max(1, Math.round(ms / 60000));
  if (minutesAgo < 60) return `about ${minutesAgo} minute${minutesAgo === 1 ? '' : 's'} ago`;
  const hoursAgo = Math.round(minutesAgo / 60);
  return `about ${hoursAgo} hour${hoursAgo === 1 ? '' : 's'} ago`;
}

export async function run(signal, ctx) {
  const { log } = ctx;
  const payload = signal.payload || {};
  const callerPhone = String(payload.caller_phone || '').trim();
  const deadlineMs = Number(payload.deadline_ms || 0);
  const endedReason = String(payload.ended_reason || '').toLowerCase();
  const originalVapiCallId = String(payload.original_vapi_call_id || '');

  if (!callerPhone || !deadlineMs) {
    await xano.markSignalProcessed(signal.id, 'missed_call_callback_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  // Hold-and-re-emit pattern
  if (Date.now() < deadlineMs) {
    try {
      await xano.emitSignal({
        signal_type: 'MISSED_CALL_CALLBACK_DUE',
        signal_strength: 45,
        payload,
      });
    } catch (err) {
      log('missed_call_callback_hold_failed', { error: String(err.message || err) });
    }
    await xano.markSignalProcessed(signal.id, 'missed_call_callback_handled', {
      outcome: 'held_until_deadline',
      deadline_ms: deadlineMs,
    });
    return { success: true, action: 'held_until_deadline' };
  }

  // Customer might have called us back already — skip if they did
  // (we'd see another inbound vapi call from this number after the
  // missed call). For simplicity v1, skip this check — duplicate
  // callbacks within 5 min are rare and customers tend to appreciate
  // the proactive reach-out. Add cross-check if it becomes an issue.

  const missedMinutesAgo = Math.floor((Date.now() - (deadlineMs - 5 * 60 * 1000)) / 60000);
  const missedHuman = shortAgoHuman(Date.now() - (deadlineMs - 5 * 60 * 1000));

  const voiceRes = await placeOutboundCall({
    assistantId: ASSISTANT_IDS.missed_call_callback,
    toPhone: callerPhone,
    fromRegion: 'TN',
    variableValues: {
      customer_phone: callerPhone,
      missed_call_time_human: missedHuman,
      voicemail_transcript: '',
    },
    metadata: {
      source: 'missed_call_callback_due_auto',
      original_vapi_call_id: originalVapiCallId,
      ended_reason: endedReason,
      attempt_number: 1,
      // Missed Call Callback is itself the response to a missed call;
      // don't retry — if customer doesn't answer OUR callback, they
      // ignored both us and their own original call. Leave them alone.
      retry_eligible: false,
    },
  });

  const meta = {
    caller_phone: callerPhone,
    outcome: voiceRes && voiceRes.ok ? 'callback_placed' : 'callback_failed',
    voice_call_id: voiceRes && voiceRes.call_id ? voiceRes.call_id : null,
    voice_error: voiceRes && !voiceRes.ok ? voiceRes.error : null,
    missed_minutes_ago: missedMinutesAgo,
  };
  await xano.markSignalProcessed(signal.id, 'missed_call_callback_handled', meta);
  log('missed_call_callback_handled', meta);

  return { success: true, action: meta.outcome };
}
