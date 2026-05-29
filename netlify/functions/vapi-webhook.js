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
  // return a config that points Vapi's "Custom LLM" at phone-ant-brain
  // and seeds runtime variables with caller context.
  if (type === 'assistant-request') {
    const pf = await prefetchCaller(callerNumber);
    return ok(buildAssistantConfig({ callerNumber, calledNumber, callId, pf }));
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

function buildAssistantConfig({ callerNumber, calledNumber, callId, pf }) {
  const knownName = pf && pf.found && pf.customer && pf.customer.first_name;
  const firstMsg = knownName
    ? `Hey ${knownName} — glad you called. What can I do for you?`
    : `Hey, you've reached TN Appliance Exchange. What's broken today?`;

  return {
    assistant: {
      name: 'Ant',
      firstMessage: firstMsg,
      firstMessageMode: 'assistant-speaks-first',
      voice: {
        provider: '11labs',
        // Replace with cloned voice ID once recorded; default Heisenberg-like
        voiceId: process.env.ANT_PHONE_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
        stability: 0.55,
        similarityBoost: 0.7,
      },
      model: {
        provider: 'custom-llm',
        url: PHONE_BRAIN_URL,
        model: 'phone-ant',
        messages: [], // server-side controls system prompt
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
      backgroundSound: 'office',
      // Variables Vapi makes available to the prompt; we duplicate them
      // into our server-side context anyway, but this is useful for
      // Vapi-side tools / templates.
      variableValues: {
        caller_number: callerNumber,
        called_number: calledNumber,
        vapi_call_id: callId,
        customer_id: pf && pf.found && pf.customer ? pf.customer.id : 0,
        customer_first_name: knownName || '',
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
