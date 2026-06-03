// Outbound Vapi calling helper. Shared by colony-loop agents that need
// to dispatch a voice call (Tech Running Late, Parts ETA Update,
// Appointment Reminder, Reschedule, Missed Call Callback, AHS Auth,
// Parts Follow-Up).
//
// Usage:
//   import { placeOutboundCall, ASSISTANT_IDS, FROM_NUMBERS } from '../vapi-out.js';
//   await placeOutboundCall({
//     assistantId: ASSISTANT_IDS.appointment_reminder,
//     toPhone: '+16154855795',
//     fromRegion: 'TN',       // picks the right outbound number
//     variableValues: {
//       customer_first_name: 'Teddy',
//       appliance_type: 'washer',
//       scheduled_when_human: 'tomorrow at ten in the morning',
//       tech_first_name: 'Jimmy',
//       job_id: 18537,
//     },
//   });

import { config } from './config.js';

const VAPI_BASE = 'https://api.vapi.ai';

// Assistant IDs in the production tnappliance@gmail.com Vapi org.
// Source-of-truth: Vapi dashboard; mirrored here for compile-time safety.
export const ASSISTANT_IDS = Object.freeze({
  inbound:                  '7cc98b0c-54a7-4d19-bd48-6dfac606e55d',
  appointment_reminder:     '5da286fa-c72b-40f9-adf0-7883665b97e6',
  tech_running_late:        '264c14fe-118d-4cfa-af8f-b6ce761c868b',
  reschedule:               '5b2a4e7f-2974-4e93-81a2-8f17dc9391d2',
  parts_eta_update:         '86755371-9605-4370-a26e-60cdadf468e9',
  missed_call_callback:     '36cd478e-b128-4529-8071-b5f241c73d69',
  ahs_authorization_update: '63030edb-fb77-4106-b048-e84aba6da358',
  parts_follow_up:          'b71260b4-c284-4657-99a4-03c9bb1a0624',
  after_hours:              'f2bb153d-71f3-4c8a-8b1f-09b01ed7ef36',
});

// Vapi phoneNumberIds. Use TN_PRIMARY for most outbound calls; LA_PRIMARY
// when calling LA-area customers (so caller ID shows a local number).
//
// IMPORTANT: Prefer Twilio-backed numbers for outbound dialing — they
// route through Twilio's STIR/SHAKEN attestation pipeline and carriers
// flag them as "Potential Spam" far less aggressively than brand-new
// Vapi-issued numbers. Once CNAM is registered for these numbers,
// callers will see "TN APPLIANCE EXCHANGE" instead of a bare number.
export const FROM_NUMBERS = Object.freeze({
  TN_PRIMARY: 'd57d5cf2-60a7-46e6-a7f0-24ed652c1f31', // +16292477111 (Twilio · TN, better attestation)
  LA_PRIMARY: '9ceaec5d-27c7-48d3-80c5-ed1028226683', // +15043559111 (Twilio · LA, better attestation)
  // Fallbacks if Twilio numbers go down
  TN_FALLBACK_VAPI: 'a62d1b14-8578-4bd4-8104-be4f1d20535f', // +17315031142 (Vapi-issued)
  LA_FALLBACK_VAPI: 'ceb53ba1-32fe-46ca-b684-3cb61bdfa6a6', // +15043800975 (Vapi-issued)
});

function pickFromNumber(region) {
  if (region === 'LA') return FROM_NUMBERS.LA_PRIMARY;
  return FROM_NUMBERS.TN_PRIMARY;
}

function normalizeE164(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (String(phone).startsWith('+')) return String(phone);
  return '+' + digits;
}

/**
 * Place an outbound Vapi call.
 * @param {Object} opts
 * @param {string} opts.assistantId  - Vapi assistant UUID
 * @param {string} opts.toPhone      - customer phone (E.164 or 10-digit)
 * @param {string} [opts.fromRegion] - 'TN' (default) or 'LA' — picks dial-from number
 * @param {string} [opts.fromNumberId] - explicit phoneNumberId override
 * @param {Object} [opts.variableValues] - {{customer_first_name}}-style prompt variables
 * @param {Object} [opts.metadata]   - arbitrary metadata Vapi stores with the call
 * @returns {Promise<{ok:boolean, call_id?:string, error?:string}>}
 */
export async function placeOutboundCall(opts) {
  if (!config.vapiPrivateKey) {
    return { ok: false, error: 'no_vapi_key' };
  }
  if (!opts || !opts.assistantId) {
    return { ok: false, error: 'assistantId required' };
  }
  const to = normalizeE164(opts.toPhone);
  if (!to) {
    return { ok: false, error: 'invalid toPhone' };
  }
  const fromNumberId = opts.fromNumberId || pickFromNumber(opts.fromRegion);

  const body = {
    assistantId: opts.assistantId,
    phoneNumberId: fromNumberId,
    customer: { number: to },
  };
  if (opts.variableValues && Object.keys(opts.variableValues).length) {
    body.assistantOverrides = { variableValues: opts.variableValues };
  }
  if (opts.metadata) {
    body.metadata = opts.metadata;
  }

  try {
    const r = await fetch(`${VAPI_BASE}/call`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.vapiPrivateKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) {
      return { ok: false, status: r.status, error: text.slice(0, 400) };
    }
    const parsed = JSON.parse(text);
    return { ok: true, call_id: parsed.id, raw: parsed };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
