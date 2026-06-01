// Reads each incoming voicemail transcript with Claude and persists a
// pre-drafted job structure (appliance / brand / symptom / zip / name /
// urgency) so Office Today can surface it as a one-tap "Call + create
// job" pill — saves Danielle the manual transcribe step.
//
// Signal in:  VOICEMAIL_RECEIVED
// Signal out: none (terminal — Office Today reads the draft directly)
// Side effects:
//   - event_log row action="voicemail_draft_<source_event_log_id>"
//     metadata={draft, source_event_log_id, caller_phone}
import { config } from '../config.js';

const VOICEMAIL_PROMPT = `You are the Voicemail Triage Agent for TN Appliance Exchange. You receive a voicemail transcript from a potential customer. Extract structured intake data so an office worker can create the job with one tap.

Return ONLY a single JSON object. No prose, no markdown, no explanation. If a field is not in the transcript, set it to empty string (or "normal" for urgency). Schema:

{
  "appliance_type": "refrigerator | dishwasher | washer | dryer | range | oven | microwave | hvac | ice_maker | freezer | other | empty if unknown",
  "brand": "Whirlpool | GE | LG | Samsung | KitchenAid | Maytag | Frigidaire | Kenmore | Bosch | Miele | Sub-Zero | Viking | Wolf | etc. — empty if unknown",
  "problem_summary": "one short sentence describing the symptom in the customer's words, max 80 chars",
  "first_name": "customer's first name if they said it",
  "zip": "5-digit zip if they said it",
  "city": "city name if mentioned",
  "urgency": "high | normal | low — high if they used words like emergency, today, ASAP, flooding, no fridge with food spoiling; low if they said no rush or whenever; else normal",
  "callback_phone": "if they read back a different phone number than the caller_phone, capture it here; else empty",
  "confidence": "high | medium | low — how confident you are in your extraction"
}

Rules:
- Output JSON only. No code fences, no commentary.
- Use lowercase for appliance_type and urgency.
- Strip honorifics from first_name (just the given name).
- problem_summary should be reader-friendly — "not cooling" beats "thermal regulation issue".
- If transcript is too short or unclear, set confidence="low" and fill what you can.`;

function stripFences(s) {
  return String(s || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

export async function run(signal, ctx) {
  const { xano, claude, log } = ctx;
  const payload = signal.payload || {};
  const eventLogId = Number(payload.event_log_id || 0);
  const transcript = String(payload.transcript || '').trim();
  const callerPhone = String(payload.caller_phone || '').trim();

  if (!eventLogId) {
    await xano.markSignalProcessed(signal.id, 'voicemail_draft_handled', {
      outcome: 'skipped_missing_event_log_id',
    });
    return { success: false, action: 'skipped_missing_event_log_id' };
  }

  // Per-source-event dedup
  const dedupAction = `voicemail_draft_${eventLogId}`;
  try {
    const prior = await xano.getEventLogByAction(dedupAction);
    if (prior && prior.exists) {
      await xano.markSignalProcessed(signal.id, 'voicemail_draft_handled', {
        event_log_id: eventLogId,
        outcome: 'skipped_already_drafted',
      });
      return { success: true, action: 'skipped_already_drafted' };
    }
  } catch (_) { /* fail-open */ }

  if (transcript.length < 20) {
    // Don't burn a Claude call on a useless transcript
    await xano.markSignalProcessed(signal.id, 'voicemail_draft_handled', {
      event_log_id: eventLogId,
      outcome: 'skipped_short_transcript',
      transcript_length: transcript.length,
    });
    return { success: true, action: 'skipped_short_transcript' };
  }

  let draft = null;
  let rawText = '';
  try {
    const resp = await claude.callClaude({
      system: VOICEMAIL_PROMPT,
      messages: [
        { role: 'user', content: 'Caller phone: ' + callerPhone + '\nTranscript:\n' + transcript },
      ],
      maxTokens: 400,
    });
    rawText = stripFences(resp || '');
    draft = JSON.parse(rawText);
  } catch (err) {
    log('voicemail_draft_failed', {
      event_log_id: eventLogId,
      error: String(err.message || err),
      raw_preview: rawText.slice(0, 200),
    });
    await xano.markSignalProcessed(signal.id, 'voicemail_draft_handled', {
      event_log_id: eventLogId,
      outcome: 'claude_or_parse_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'claude_or_parse_failed' };
  }

  // Normalize draft fields
  const safe = (s) => String(s || '').trim();
  const cleanDraft = {
    appliance_type : safe(draft.appliance_type).toLowerCase(),
    brand          : safe(draft.brand),
    problem_summary: safe(draft.problem_summary).slice(0, 120),
    first_name     : safe(draft.first_name),
    zip            : safe(draft.zip).replace(/\D/g, '').slice(0, 5),
    city           : safe(draft.city),
    urgency        : (safe(draft.urgency).toLowerCase() || 'normal'),
    callback_phone : safe(draft.callback_phone),
    confidence     : (safe(draft.confidence).toLowerCase() || 'medium'),
  };

  // Persist via dedup-action event_log row
  await xano.markSignalProcessed(signal.id, dedupAction, {
    source_event_log_id: eventLogId,
    caller_phone       : callerPhone,
    draft              : cleanDraft,
    outcome            : 'draft_persisted',
  });

  return {
    success: true,
    action: 'draft_persisted',
    event_log_id: eventLogId,
    draft: cleanDraft,
  };
}
