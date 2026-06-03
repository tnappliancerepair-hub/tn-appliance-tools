// Generic outbound retry handler. Triggered by OUTBOUND_RETRY_DUE
// signal (emitted by vapi-webhook.js when an auto-triggered outbound
// call ends in voicemail/no-answer and is retry-eligible).
//
// Hold-and-re-emit until the deadline, then place the call with the
// same assistant + variableValues. Increments attempt_number in
// metadata so a second voicemail won't trigger a third call.
//
// Max attempts is hard-capped at 2 (original + one retry) regardless
// of payload to prevent runaway retry loops.

import * as xano from '../xano.js';
import { placeOutboundCall } from '../vapi-out.js';

const MAX_ATTEMPTS = 2;

export async function run(signal, ctx) {
  const { log } = ctx;
  const payload = signal.payload || {};
  const deadlineMs = Number(payload.deadline_ms || 0);
  const assistantId = String(payload.assistant_id || '').trim();
  const toPhone = String(payload.to_phone || '').trim();
  const fromRegion = String(payload.from_region || 'TN').trim();
  const attemptNumber = Number(payload.attempt_number || 2);
  const variableValues = payload.variable_values || {};
  const originalSource = String(payload.original_source || 'unknown');

  if (!deadlineMs || !assistantId || !toPhone) {
    await xano.markSignalProcessed(signal.id, 'outbound_retry_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  // Hard cap
  if (attemptNumber > MAX_ATTEMPTS) {
    await xano.markSignalProcessed(signal.id, 'outbound_retry_handled', {
      outcome: 'skipped_max_attempts',
      attempt_number: attemptNumber,
    });
    return { success: true, action: 'skipped_max_attempts' };
  }

  // Hold-and-re-emit
  if (Date.now() < deadlineMs) {
    try {
      await xano.emitSignal({
        signal_type: 'OUTBOUND_RETRY_DUE',
        signal_strength: 45,
        payload,
      });
    } catch (err) {
      log('outbound_retry_hold_failed', { error: String(err.message || err) });
    }
    await xano.markSignalProcessed(signal.id, 'outbound_retry_handled', {
      outcome: 'held_until_deadline',
      deadline_ms: deadlineMs,
      attempt_number: attemptNumber,
    });
    return { success: true, action: 'held_until_deadline' };
  }

  // Place the retry call. Metadata flags this as a retry so the
  // webhook won't schedule yet another retry on top.
  const voiceRes = await placeOutboundCall({
    assistantId,
    toPhone,
    fromRegion,
    variableValues,
    metadata: {
      source: originalSource,
      attempt_number: attemptNumber,
      retry_eligible: false, // max 1 retry — don't compound
      original_source: originalSource,
    },
  });

  const meta = {
    outcome: voiceRes && voiceRes.ok ? 'retry_placed' : 'retry_failed',
    voice_call_id: voiceRes && voiceRes.call_id ? voiceRes.call_id : null,
    voice_error: voiceRes && !voiceRes.ok ? voiceRes.error : null,
    attempt_number: attemptNumber,
    original_source: originalSource,
    to_phone: toPhone,
  };
  await xano.markSignalProcessed(signal.id, 'outbound_retry_handled', meta);
  log('outbound_retry_handled', meta);

  return { success: true, action: meta.outcome };
}
