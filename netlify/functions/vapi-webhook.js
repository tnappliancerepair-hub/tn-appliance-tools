// Vapi voice-assistant webhook receiver. Wired to inbound calls on
// the vanity numbers 1-888-ANT-8998 + 1-866-ANT-0111 (operator config
// in Vapi dashboard) — once those are routed via Vapi.
//
// Events handled:
//   - assistant-request → reply with dynamic assistant config that
//     points the LLM at /phone-ant-brain. Pre-loads caller context.
//   - call-start         → record inbound call attempt + emit
//                          VAPI_CALL_STARTED for downstream agents
//   - call-end           → record transcript + ALSO write a structured
//                          phone_call_summary event_log row +
//                          brain_observation (so OTHER brains see it
//                          next time anyone opens this customer)
//                          + emit VAPI_CALL_COMPLETED signal
//   - tool-calls         → executes phone-brain tool calls if Vapi
//                          requests them (we use custom LLM mostly,
//                          but this stays for backward compat)
//
// Always returns 200 so Vapi doesn't retry.

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const XANO_RECORD_VAPI = `${XANO_BASE}/record_vapi_call`;
const XANO_RECORD_EVENT = `${XANO_BASE}/record_event_log`;
const XANO_LOOKUP_CUSTOMER = `${XANO_BASE}/lookup_customer_by_phone`;
const XANO_RECORD_BRAIN_OBS = `${XANO_BASE}/record_brain_observation`;

const PHONE_BRAIN_URL = 'https://tnapplianceexchange.net/.netlify/functions/phone-ant-brain';
const PHONE_OUTBOUND_URL = 'https://tnapplianceexchange.net/.netlify/functions/phone-ant-outbound';

// Known warranty company / B2B caller patterns. When a call comes in
// from one of these area codes / number prefixes, we flip to
// professional B2B tone via a different voice + tighter system prompt.
// Operator can add more as they learn them.
const B2B_NUMBER_PREFIXES = [
  '+1888', // AHS dispatch typically masked behind 888
  '+1800',
];
const KNOWN_WARRANTY_NUMBERS = (process.env.ANT_KNOWN_WARRANTY_NUMBERS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function classifyCaller({ callerNumber, prefetchedCustomer }) {
  // Known warranty company by exact number
  if (KNOWN_WARRANTY_NUMBERS.some((n) => callerNumber.endsWith(n.replace(/\D/g, '').slice(-10)))) {
    return { tone: 'b2b', kind: 'warranty_company' };
  }
  // Known customer
  if (prefetchedCustomer && prefetchedCustomer.found) {
    return { tone: 'warm_returning', kind: 'returning_customer' };
  }
  // Unknown caller — possible new customer
  return { tone: 'warm_new', kind: 'new_customer' };
}

// Number profiles — keyed by the called number (last 10 digits, no
// formatting). Each profile carries: brand_id (for first-message),
// market_context, callback_hint (when this number is one customers
// likely got TEXTED FROM), and tech_side flag (when this number is
// the tech-direction line). Updated as numbers are ported to Vapi.
//
// Single source of truth for "what does this number mean." If you
// rearrange the strategy, update HERE — no other file needs touching.
const NUMBER_PROFILES = {
  // ── Primary TN — RingCentral port (Sprint 1) ───────────────────
  '6152802949': {
    role: 'primary_tn',
    provider: 'vapi',
    market_context: 'Middle Tennessee — Nashville, Murfreesboro, Antioch, Clarksville and surrounding.',
    callback_hint: '',
    tech_side: false,
  },
  // ── Louisiana market (already on Vapi BYO) ────────────────────
  '5043559111': {
    role: 'la_market',
    provider: 'vapi',
    market_context: 'Louisiana — New Orleans, Baton Rouge, Hammond and surrounding parishes.',
    callback_hint: '',
    tech_side: false,
  },
  // ── Vanity national ───────────────────────────────────────────
  '8882688998': { role: 'vanity_888', provider: 'vanity', market_context: 'National vanity (1-888-ANT-8998).', callback_hint: '', tech_side: false },
  '8662680111': { role: 'vanity_866', provider: 'vanity', market_context: 'National vanity (1-866-ANT-0111).', callback_hint: '', tech_side: false },

  // ── Telnyx (primary SMS) ──────────────────────────────────────
  // Customer line — texted FROM this number, now answers calls back.
  // Critical for closing the "they texted me, I called back, dead air"
  // leak. Caller likely got a recent SMS from us.
  '6155889500': {
    role: 'customer_sms_callback',
    provider: 'telnyx',
    market_context: '',
    callback_hint: 'PRIMARY customer-direction line (Telnyx). Caller likely got a recent SMS from us and called back. Open like: "Hey — got your number from a text we sent. What\'s going on?" Pull recent customer-direction SMS for this caller if any.',
    tech_side: false,
  },
  '6158578800': {
    role: 'tech_sms_callback',
    provider: 'telnyx',
    market_context: '',
    callback_hint: 'PRIMARY tech-direction line (Telnyx). Caller is likely one of our techs (cross-check caller_number against tech roster). If caller is a tech, switch to tech-assist context — they need job/parts help, not customer-service warmth.',
    tech_side: true,
  },

  // ── Twilio (SMS failover for Telnyx) ───────────────────────────
  // Inbound to these should ALSO reach Ant — same role as their
  // Telnyx counterparts. When Telnyx is down and send_sms falls
  // back to Twilio, customers see these as the from-number; they
  // may call them back. Don't let them die in Twilio demo IVR.
  '6292840444': {
    role: 'customer_sms_callback',
    provider: 'twilio',
    market_context: '',
    callback_hint: 'Customer-direction FAILOVER line (Twilio). Same handling as Telnyx 615-588-9500 — caller likely got a recent SMS from us and called back.',
    tech_side: false,
  },
  '7273508487': {
    role: 'tech_sms_callback',
    provider: 'twilio',
    market_context: '',
    callback_hint: 'Tech-direction FAILOVER line (Twilio). Same handling as Telnyx 615-857-8800 — caller likely a tech.',
    tech_side: true,
  },

  // ── Vapi BYO TN numbers — KEEP as SaaS multi-tenant inventory ──
  // Per docs/phone-number-strategy.md "Strategic Inventory" principle.
  // These were originally Vapi-acquired for TN use; once we go multi-
  // tenant (saas_strategy memory), they're reserves for spinning up
  // tenant-specific assistants without going through Vapi's
  // provisioning queue. Cost ~$1/mo each = obvious to hold.
  '6292607111': {
    role: 'vapi_secondary_tn',
    provider: 'vapi',
    market_context: 'Middle Tennessee.',
    callback_hint: 'Secondary TN Vapi number. Treat like primary_tn for opening. Reserved as SaaS tenant inventory for future multi-tenant rollout.',
    tech_side: false,
  },
  '6292477111': {
    role: 'vapi_secondary_tn',
    provider: 'vapi',
    market_context: 'Middle Tennessee.',
    callback_hint: 'Secondary TN Vapi number. Treat like primary_tn for opening. Reserved as SaaS tenant inventory for future multi-tenant rollout.',
    tech_side: false,
  },

  // ── KILL list — DO NOT route ─────────────────────────────────
  // These two Twilio numbers point at Twilio's demo IVR. If they ever
  // get hit by a real caller, brand-conflict disaster. Listed here so
  // we have a record, but they should be DELETED in the Twilio dashboard.
  // If they somehow reach this code, brain treats them as unknown.
  // (570) 378-8177  — DELETE
  // (234) 219-3439  — DELETE
};

function profileForCalledNumber(calledNumber) {
  const last10 = String(calledNumber || '').replace(/\D/g, '').slice(-10);
  return NUMBER_PROFILES[last10] || { role: 'unknown', market_context: '', callback_hint: '', tech_side: false };
}

// Voice ID selector per tone. Operator overrides via env so the
// same code works through voice-cloning rollout.
function voiceIdForTone(tone) {
  const map = {
    warm_returning: process.env.ANT_PHONE_VOICE_TEDDY || process.env.ANT_PHONE_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
    warm_new:       process.env.ANT_PHONE_VOICE_TEDDY || process.env.ANT_PHONE_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
    b2b:            process.env.ANT_PHONE_VOICE_B2B   || process.env.ANT_PHONE_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL',
  };
  return map[tone] || map.warm_new;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 200, body: 'ack' }; }

  const msg = (body && body.message) || body;
  const type = String(msg.type || msg.event || '').toLowerCase();
  const call = msg.call || {};
  const callerNumber = String(call.customer && call.customer.number || msg.from || '').trim();
  const calledNumber = String(call.phoneNumber && call.phoneNumber.number || msg.to || '').trim();
  const callId = String(call.id || msg.call_id || '').trim();

  // ── assistant-request: return dynamic assistant config ────────────
  // Vapi calls this at call-start to learn what assistant to use. We
  // return a config that points Vapi's "Custom LLM" at the right brain
  // (inbound vs outbound), with classified tone + voice + first message.
  if (type === 'assistant-request') {
    // Outbound calls: Vapi passes variableValues including purpose
    const vars = (call && call.variableValues) || {};
    const isOutbound = !!vars.purpose;
    if (isOutbound) {
      return ok(buildOutboundAssistantConfig({ callerNumber, calledNumber, callId, vars }));
    }
    const pf = await prefetchCaller(callerNumber);
    const classification = classifyCaller({ callerNumber, prefetchedCustomer: pf });
    const numberProfile = profileForCalledNumber(calledNumber);
    return ok(buildAssistantConfig({ callerNumber, calledNumber, callId, pf, classification, numberProfile }));
  }

  // ── call-start ────────────────────────────────────────────────────
  if (type === 'call-start' || type === 'call-started') {
    await safePost(XANO_RECORD_VAPI, {
      caller_number: callerNumber,
      called_number: calledNumber,
      vapi_call_id: callId,
      event_type: 'call-start',
      transcript: '',
      summary: '',
    });
    return ok('ack');
  }

  // ── call-end ──────────────────────────────────────────────────────
  if (type === 'call-end' || type === 'end-of-call-report' || type === 'end-of-call') {
    const transcript = String(msg.transcript || '').slice(0, 12000);
    const summary = String(msg.summary || msg.endedReason || '').slice(0, 1500);
    const endedReason = String(msg.endedReason || msg.ended_reason || '').slice(0, 200);
    const durationSec = Number(msg.durationSeconds || msg.duration_seconds || 0);

    // Resolve customer (if we recognize the caller, write the summary
    // events keyed to customer_id so downstream lookups find them)
    let customerId = 0;
    try {
      const r = await fetch(`${XANO_LOOKUP_CUSTOMER}?phone=${encodeURIComponent(callerNumber)}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) {
        const d = await r.json();
        if (d && d.found && d.customer) customerId = Number(d.customer.id) || 0;
      }
    } catch (_) {}

    // 1. Existing record_vapi_call write — preserves the original
    //    VAPI_CALL_COMPLETED signal chain
    await safePost(XANO_RECORD_VAPI, {
      caller_number: callerNumber,
      called_number: calledNumber,
      vapi_call_id: callId,
      event_type: type,
      transcript,
      summary,
    });

    // 2. Structured phone_call_summary event_log row — read by
    //    get_recent_call_summary so future calls find it.
    //    NOW also tags with job_id when known (from call metadata for
    //    outbound, OR from most-recent open job for inbound) so the
    //    summary surfaces on per-job timelines via get_job_event_stream.
    let resolvedJobId = 0;
    const callMetaEarly = (msg.call && msg.call.metadata) || msg.metadata || {};
    if (callMetaEarly && callMetaEarly.job_id) {
      resolvedJobId = Number(callMetaEarly.job_id) || 0;
    }
    // For inbound calls without a job_id in metadata, look up the
    // customer's most-recent open job and tag the call against it.
    if (!resolvedJobId && customerId) {
      try {
        const r = await fetch(`${XANO_BASE}/get_most_recent_open_job_for_customer?customer_id=${customerId}`, {
          signal: AbortSignal.timeout(3000),
        });
        if (r.ok) {
          const d = await r.json();
          if (d && d.job_id) resolvedJobId = Number(d.job_id) || 0;
        }
      } catch (_) {}
    }
    await safePost(XANO_RECORD_EVENT, {
      action: 'phone_call_summary',
      metadata_json: JSON.stringify({
        customer_id: customerId,
        job_id: resolvedJobId,
        caller_phone: callerNumber,
        called_phone: calledNumber,
        vapi_call_id: callId,
        duration_sec: durationSec,
        ended_reason: endedReason,
        summary: summary.slice(0, 1000),
        transcript_preview: transcript.slice(0, 2000),
        recorded_at: Date.now(),
      }),
    });

    // 3. Cross-brain observation — every other brain working on this
    //    customer in the next 14 days sees what we discussed
    if (customerId && summary) {
      await safePost(XANO_RECORD_BRAIN_OBS, {
        source_brain: 'phone_ant',
        entity_type: 'customer',
        entity_id: String(customerId),
        observation: `Phone call (${Math.round(durationSec / 60)}min): ${summary.slice(0, 300)}`,
        weight: 'medium',
        topic: 'call_summary',
      });
    }

    // 4a. OUTBOUND retry — when an auto-triggered outbound call ends
    //     in voicemail/no-answer AND the call's metadata flags it as
    //     retry-eligible AND it was the first attempt, schedule one
    //     retry 30 min later via OUTBOUND_RETRY_DUE signal. Smart
    //     retry only: skip if customer-ended-call (they actively hung up).
    const callMeta = (msg.call && msg.call.metadata) || msg.metadata || {};
    const voicemailReasons = ['voicemail', 'customer-busy', 'customer-did-not-answer', 'no-answer', 'silence-timed-out'];
    const isVoicemailish = voicemailReasons.some((r) => endedReason.toLowerCase().includes(r));
    if (isVoicemailish && callMeta.retry_eligible === true && Number(callMeta.attempt_number || 1) < 2) {
      const retryDeadlineMs = Date.now() + 30 * 60 * 1000; // 30 min from now
      const toPhone = (msg.call && msg.call.customer && msg.call.customer.number)
        || callMeta.to_phone
        || callerNumber;
      await safePost(`${XANO_BASE}/emit_colony_signal`, {
        signal_type: 'OUTBOUND_RETRY_DUE',
        signal_strength: 55,
        payload_json: JSON.stringify({
          deadline_ms: retryDeadlineMs,
          assistant_id: callMeta.assistant_id || '',
          to_phone: toPhone,
          from_region: callMeta.from_region || 'TN',
          variable_values: callMeta.variable_values || {},
          attempt_number: Number(callMeta.attempt_number || 1) + 1,
          original_source: callMeta.source || 'unknown',
          original_vapi_call_id: callId,
          original_ended_reason: endedReason,
        }),
      });
      await safePost(XANO_RECORD_EVENT, {
        action: 'outbound_retry_scheduled',
        metadata_json: JSON.stringify({
          original_vapi_call_id: callId,
          original_source: callMeta.source,
          ended_reason: endedReason,
          retry_deadline_ms: retryDeadlineMs,
          to_phone: toPhone,
        }),
      });
    }

    // 4a-bis. ANT FIELD ASSIST — when a tech-side call from the green
    //     "Talk to Ant" button ends, SMS Teddy a tight summary within
    //     ~2 min so he sees adoption + how the call went in near-realtime.
    //     Skips voicemail/no-answer calls (those happen when tech declines).
    const isFieldAssist = callMeta.source === 'ant_field_assist_dispatch';
    if (isFieldAssist && !isVoicemailish) {
      const techId = callMeta.tech_id || '?';
      const jobId = callMeta.job_id || '?';
      const techNames = { '1': 'Teddy', '2': 'Jimmy', '3': 'Andre', '4': 'Lee', '5': 'Billy', '6': 'John' };
      const techName = techNames[String(techId)] || `tech ${techId}`;
      const durMin = Math.max(1, Math.round(durationSec / 60));
      const summaryShort = (summary || '').slice(0, 280).replace(/\s+/g, ' ').trim() || endedReason || 'no summary';
      const body = `[ant field assist] ${techName} just finished a ${durMin}min call on job #${jobId}. ${summaryShort}`;
      await safePost(`${XANO_BASE}/send_sms`, {
        to: process.env.OWNER_PHONE_NUMBER || '+16154855795',
        message: body.slice(0, 600),
        recipient_role: 'owner',
        context: { source: 'ant_field_assist_call_summary', job_id: jobId, tech_id: techId, vapi_call_id: callId, duration_sec: durationSec, ended_reason: endedReason },
      });
      await safePost(XANO_RECORD_EVENT, {
        action: 'ant_field_assist_call_summary_sent',
        metadata_json: JSON.stringify({
          job_id: jobId,
          tech_id: techId,
          vapi_call_id: callId,
          duration_sec: durationSec,
          ended_reason: endedReason,
          summary: summary.slice(0, 800),
        }),
      });
    }

    // 4b. Missed Call Callback — when an INBOUND call ended without a
    //     real conversation, schedule a callback in 5 min via Ant.
    //     Only fires for INBOUND (not outbound voicemails we just left).
    const callbackEnabled = String(process.env.MISSED_CALL_CALLBACK_ENABLED || 'true').toLowerCase() !== 'false';
    const isOutboundLeg = callMeta.source && String(callMeta.source).includes('_auto');
    const missedReasons = ['voicemail', 'customer-busy', 'customer-did-not-answer', 'no-answer', 'silence-timed-out'];
    const isMissed = missedReasons.some((r) => endedReason.toLowerCase().includes(r));
    if (callbackEnabled && isMissed && !isOutboundLeg && callerNumber && callerNumber.startsWith('+')) {
      const deadlineMs = Date.now() + 5 * 60 * 1000; // 5 minutes from now
      await safePost(`${XANO_BASE}/emit_colony_signal`, {
        signal_type: 'MISSED_CALL_CALLBACK_DUE',
        signal_strength: 65,
        payload_json: JSON.stringify({
          caller_phone: callerNumber,
          called_phone: calledNumber,
          customer_id: customerId,
          ended_reason: endedReason,
          deadline_ms: deadlineMs,
          original_vapi_call_id: callId,
          duration_sec: durationSec,
        }),
      });
      await safePost(XANO_RECORD_EVENT, {
        action: 'missed_call_callback_scheduled',
        metadata_json: JSON.stringify({
          caller_phone: callerNumber,
          ended_reason: endedReason,
          deadline_ms: deadlineMs,
          original_vapi_call_id: callId,
        }),
      });
    }
    return ok('ack');
  }

  // Unknown / other event type — ack so Vapi doesn't retry
  return ok('ack');
};

// ── Helpers ───────────────────────────────────────────────────────
async function safePost(url, body) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch (_) {}
}

async function prefetchCaller(phone) {
  if (!phone) return null;
  try {
    const r = await fetch(`${XANO_LOOKUP_CUSTOMER}?phone=${encodeURIComponent(phone)}`, {
      signal: AbortSignal.timeout(3500),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

// Vapi-side function definitions for live warm-transfer. When the
// brain decides to escalate, it calls `transfer_to_human` (a custom
// LLM tool we route at our end) OR Vapi's built-in transferCall
// function if we declared one with destinations. We declare both:
//   - transferCall (Vapi-native): destinations Teddy + Danielle
//   - end_call: clean end-of-conversation hangup
const TRANSFER_DESTINATIONS = [
  {
    type: 'number',
    number: process.env.OWNER_PHONE_NUMBER || '+16154855795',
    description: 'Teddy — owner. First-choice for escalations, complaints, special requests.',
    message: 'Connecting you with Teddy now — hang on one second.',
  },
  {
    type: 'number',
    number: process.env.DANIELLE_PHONE_NUMBER || '+16154850713',
    description: 'Danielle — office manager. Handles scheduling, warranty, billing, customer service.',
    message: 'Putting you through to Danielle — one moment.',
  },
];

function buildAssistantConfig({ callerNumber, calledNumber, callId, pf, classification, numberProfile }) {
  const knownName = pf && pf.found && pf.customer && pf.customer.first_name;
  const tone = (classification && classification.tone) || 'warm_new';
  const kind = (classification && classification.kind) || 'new_customer';
  const role = (numberProfile && numberProfile.role) || 'unknown';

  // First message branches on (1) called-number profile, then
  // (2) caller classification. customer_sms_callback (615-588-9500)
  // wins because that's the highest-context number — customer
  // probably called to follow up on a recent text.
  let firstMsg;
  if (role === 'customer_sms_callback') {
    firstMsg = knownName
      ? `Hey ${knownName} — got your call, looks like you saw our text. What's going on?`
      : `Hey — got your number from a text we sent recently. What can I do for you?`;
  } else if (role === 'tech_sms_callback') {
    firstMsg = `Hey — what do you need?`;
  } else if (role === 'la_market') {
    firstMsg = knownName
      ? `Hey ${knownName} — glad you called TN Appliance Exchange Louisiana. What's going on?`
      : `Hey, you've reached TN Appliance Exchange — we cover New Orleans, Baton Rouge, Hammond. What's broken today?`;
  } else if (kind === 'warranty_company') {
    firstMsg = `Hi, this is Ant with TN Appliance Exchange. Who am I speaking with and how can I help?`;
  } else if (knownName) {
    firstMsg = `Hey ${knownName} — glad you called. What can I do for you?`;
  } else {
    firstMsg = `Hey, you've reached TN Appliance Exchange. What's broken today?`;
  }

  return {
    assistant: {
      name: 'Ant',
      firstMessage: firstMsg,
      firstMessageMode: 'assistant-speaks-first',
      voice: {
        provider: '11labs',
        voiceId: voiceIdForTone(tone),
        stability: tone === 'b2b' ? 0.65 : 0.55,
        similarityBoost: 0.7,
      },
      model: {
        provider: 'custom-llm',
        url: PHONE_BRAIN_URL,
        model: 'phone-ant',
        messages: [],
      },
      transcriber: {
        provider: 'deepgram',
        model: 'nova-2-phonecall',
        language: 'en',
        smartFormat: true,
      },
      endCallFunctionEnabled: true,
      endCallPhrases: ['goodbye', 'bye now', 'take care', 'thank you bye'],
      maxDurationSeconds: 900,
      silenceTimeoutSeconds: 30,
      responseDelaySeconds: 0.3,
      llmRequestDelaySeconds: 0.1,
      numWordsToInterruptAssistant: 2,
      backgroundSound: tone === 'b2b' ? 'off' : 'office',
      // Vapi-native transferCall function — caller can be warm-transferred
      // by the brain. The brain decides + sets destination in its reply
      // text; Vapi parses the function call from the LLM response.
      forwardingPhoneNumbers: TRANSFER_DESTINATIONS.map(d => d.number),
      transferDestinations: TRANSFER_DESTINATIONS,
      variableValues: {
        caller_number: callerNumber,
        called_number: calledNumber,
        vapi_call_id: callId,
        customer_id: pf && pf.found && pf.customer ? pf.customer.id : 0,
        customer_first_name: knownName || '',
        caller_classification: kind,
        caller_tone: tone,
        called_number_role: role,
        called_number_market: (numberProfile && numberProfile.market_context) || '',
        called_number_callback_hint: (numberProfile && numberProfile.callback_hint) || '',
        tech_side_call: !!(numberProfile && numberProfile.tech_side),
      },
    },
  };
}

// Outbound assistant config — brain swap, voice swap, tighter
// max-duration since outbound calls should be short.
function buildOutboundAssistantConfig({ callerNumber, calledNumber, callId, vars }) {
  const purpose = String(vars.purpose || 'missed_call_callback').toLowerCase();
  return {
    assistant: {
      name: 'Ant Outbound',
      firstMessageMode: 'assistant-speaks-first',
      // For outbound, let the brain's first turn drive the opening — Vapi
      // calls our LLM with empty messages on connect, brain reads
      // SCENARIOS[purpose].open_template and produces the open.
      firstMessage: '',
      voice: {
        provider: '11labs',
        voiceId: voiceIdForTone('warm_returning'),
        stability: 0.55,
        similarityBoost: 0.7,
      },
      model: {
        provider: 'custom-llm',
        url: PHONE_OUTBOUND_URL,
        model: 'phone-ant-outbound',
        messages: [],
      },
      transcriber: {
        provider: 'deepgram',
        model: 'nova-2-phonecall',
        language: 'en',
        smartFormat: true,
      },
      endCallFunctionEnabled: true,
      endCallPhrases: ['goodbye', 'bye now', 'take care', 'thank you bye'],
      maxDurationSeconds: 300, // outbound: keep it tight
      silenceTimeoutSeconds: 20,
      responseDelaySeconds: 0.3,
      llmRequestDelaySeconds: 0.1,
      numWordsToInterruptAssistant: 2,
      backgroundSound: 'office',
      forwardingPhoneNumbers: TRANSFER_DESTINATIONS.map(d => d.number),
      transferDestinations: TRANSFER_DESTINATIONS,
      variableValues: {
        ...vars,
        called_number: calledNumber,
        vapi_call_id: callId,
      },
    },
  };
}

function ok(body) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}
