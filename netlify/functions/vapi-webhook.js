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
    return ok(buildAssistantConfig({ callerNumber, calledNumber, callId, pf, classification }));
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
    //    get_recent_call_summary so future calls find it
    await safePost(XANO_RECORD_EVENT, {
      action: 'phone_call_summary',
      metadata_json: JSON.stringify({
        customer_id: customerId,
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

function buildAssistantConfig({ callerNumber, calledNumber, callId, pf, classification }) {
  const knownName = pf && pf.found && pf.customer && pf.customer.first_name;
  const tone = (classification && classification.tone) || 'warm_new';
  const kind = (classification && classification.kind) || 'new_customer';

  let firstMsg;
  if (kind === 'warranty_company') {
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
