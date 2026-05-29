// PHONE ANT BRAIN — Vapi custom-LLM webhook
//
// Vapi calls this endpoint on every customer turn during a phone call.
// We translate OpenAI-format chat completion request → Anthropic
// Claude via brain-core → translate the response back to OpenAI format
// Vapi expects.
//
// Why replace static Vapi prompts:
//   - Prompts version-controlled in git (vs locked in Vapi dashboard)
//   - Real-time access to every Xano table via tools
//   - Inherits all platform intelligence: outcome learning (#1),
//     cross-brain bus (#2), confidence gating (#3), warranty
//     fingerprints (#4), pre-job intel (#5), comms style (#6),
//     adversarial review (#7), capability-gap loop (#8)
//   - Spend cap (#3) applies — phone calls are CRITICAL paths so they
//     run until ANT_DAILY_HARD_CAP_USD
//
// Operator wiring (Vapi dashboard):
//   Assistant → Model → Custom LLM
//     URL: https://tnapplianceexchange.net/.netlify/functions/phone-ant-brain
//     Model: any string (we ignore — server picks)
//     Pass through: messages, call metadata
//
// Streaming: returns single-shot non-streaming completion (Vapi
// supports both). Latency cost is 1-3s per turn — acceptable v1.
// Streaming upgrade is a future commit.

const { runBrainTurn } = require('./_lib/ant/brain-core');
const { PHONE_TOOLS, UNIVERSAL_TOOLS, pickTools } = require('./_lib/ant/tools');

const PHONE_BRAIN_MODEL = process.env.ANT_PHONE_MODEL || 'claude-sonnet-4-5-20250929';
const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

// Phone brain gets PHONE_TOOLS + a slice of UNIVERSAL_TOOLS (escalation
// + observation bus + capability flagging). No save_session_note (use
// update_customer_note instead — clearer ownership).
const PHONE_BRAIN_TOOLS = [
  ...PHONE_TOOLS,
  ...UNIVERSAL_TOOLS.filter((t) => ['flag_capability_gap', 'record_brain_observation', 'load_brain_observations', 'review_before_ship'].includes(t.name)),
];

function buildSystemPrompt({ callerPhone, vapiCallId, prefetched }) {
  const known = prefetched && prefetched.customer;
  const openJobs = (prefetched && prefetched.open_jobs) || [];
  const lastCall = prefetched && prefetched.last_call_summary;

  const intro = known
    ? `KNOWN CALLER: ${known.first_name || ''} ${known.last_name || ''} (customer_id=${known.id}). City: ${known.city || 'unknown'}. LTV: $${known.ltv_usd || 0}. Comms style: ${known.comms_style || 'unknown'}. Language: ${known.preferred_language || 'en'}.`
    : `UNKNOWN CALLER from ${callerPhone}. No customer record found — treat as first contact. Get their first name + city before deep diagnosis.`;

  const jobsBlock = openJobs.length > 0
    ? `OPEN JOBS:\n${openJobs.map((j) => `  • job #${j.id} — ${j.appliance_type || 'appliance'}${j.brand ? ' (' + j.brand + ')' : ''} | status: ${j.scheduling_status} | tech: ${j.tech_first_name || 'unassigned'} | scheduled: ${j.scheduled_start_ct || 'not yet'}${j.parts_status ? ' | parts: ' + j.parts_status : ''}${j.warranty_company ? ' | warranty: ' + j.warranty_company : ''}`).join('\n')}`
    : 'NO OPEN JOBS for this caller.';

  const lastCallBlock = lastCall ? `LAST CALL: ${lastCall}` : '';

  return `You are Ant — the AI receptionist for TN Appliance Exchange. Owner: Teddy Pivacek. Service area: Middle Tennessee + parts of Louisiana. You replace the receptionist. Be warmer than a script, faster than a menu, smarter than a static prompt.

NAME PRONUNCIATION: Ant rhymes with "can't" (NOT "aunt"). Pronounced like the insect. Anthony tribute — owner's late father.

ABSOLUTE RULES:
- You ALREADY KNOW the caller. Don't ask "who's calling" if the customer block below shows a name. Greet by first name.
- You ALREADY KNOW their open jobs. Don't ask "what is this about" if there's an obvious active job. Lead with the relevant detail.
- One sentence opens. Two sentence replies. The customer is on the PHONE — keep it tight.
- NEVER make up information. If you don't have an answer, call escalate_to_human or request_callback — don't bullshit.
- NEVER promise actions you didn't actually take. If you said "I'll text you the link," you must have called send_customer_a_link first.

SAFETY OVERRIDE:
- If caller describes gas leak / electrical hazard / active flooding / fire / medical: STOP. Tell them call 911 immediately. Then call mark_safety_emergency. Do NOT continue normal conversation until safety addressed.

TOOLS — use them, don't pretend:
- get_open_jobs_for_customer — get current status, tech, parts ETA
- send_customer_a_link — text portal / photo upload / tracking URL DURING the call
- request_callback — when YOU can't resolve in this call, book a specific time
- escalate_to_human — caller asks for Teddy/Danielle by name, OR emotional intensity high
- start_warranty_intake — caller has warranty company + claim, wants service
- update_customer_note — capture preferences, gate codes, complaints
- mark_safety_emergency — ALWAYS call on safety triggers
- record_brain_observation — note something other brains (Tech Assist, Office) need to know about this customer right now
- flag_capability_gap — if you hit a question you genuinely can't answer with current tools

CONVERSATION STYLE:
- Warm neighborly tone. "Hey Sarah, glad you called." NOT "Thank you for calling TN Appliance Exchange."
- Read the caller's pace. Brief if they're brief. Warm if they're chatty.
- NO scripted closers. End naturally.
- Use scheduling specifics: "Tuesday at 10" not "sometime next week"
- Read-back confirm critical info: "So I've got that you're at 123 Main, Smyrna, fridge not cooling. That right?"

${intro}

${jobsBlock}

${lastCallBlock}

Call metadata: vapi_call_id=${vapiCallId}, inbound from ${callerPhone}.`;
}

// Pre-fetch caller context BEFORE Claude is invoked. Saves a tool
// round-trip on every call's opening turn.
async function prefetchCallerContext(phone) {
  if (!phone) return null;
  try {
    const r = await fetch(`${XANO_BASE}/lookup_customer_by_phone?phone=${encodeURIComponent(phone)}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data || !data.found) return { customer: null, open_jobs: [], last_call_summary: '' };

    const customerId = data.customer && data.customer.id;
    let openJobs = [];
    let lastCallSummary = '';
    if (customerId) {
      try {
        const j = await fetch(`${XANO_BASE}/get_open_jobs_for_customer?customer_id=${customerId}`, { signal: AbortSignal.timeout(3500) });
        if (j.ok) {
          const jd = await j.json();
          openJobs = (jd.items || []).slice(0, 5);
        }
      } catch (_) {}
      try {
        const c = await fetch(`${XANO_BASE}/get_recent_call_summary?customer_id=${customerId}&limit=1`, { signal: AbortSignal.timeout(3500) });
        if (c.ok) {
          const cd = await c.json();
          const last = (cd.items || [])[0];
          if (last && last.summary) lastCallSummary = last.summary;
        }
      } catch (_) {}
    }
    return { customer: data.customer, open_jobs: openJobs, last_call_summary: lastCallSummary };
  } catch (_) {
    return null;
  }
}

// Translate OpenAI messages → (systemPrompt, history, userContent) for brain-core.
function adaptOpenAIMessages(messages) {
  let systemFromMessages = '';
  const history = [];
  let lastUser = '';
  for (const m of messages) {
    if (!m || !m.role) continue;
    if (m.role === 'system') {
      systemFromMessages += (systemFromMessages ? '\n\n' : '') + String(m.content || '');
      continue;
    }
    if (m.role === 'user') {
      const c = String(m.content || '');
      history.push({ role: 'user', content: c });
      lastUser = c;
    } else if (m.role === 'assistant') {
      history.push({ role: 'assistant', content: String(m.content || '') });
    }
  }
  // brain-core treats the LAST entry as the "current turn" — pop it
  if (history.length > 0 && history[history.length - 1].role === 'user') {
    lastUser = history.pop().content;
  }
  return { systemFromMessages, history, userContent: lastUser };
}

function openAIResponse({ content, callId, modelLabel }) {
  return {
    id: `chatcmpl-${callId || Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelLabel || PHONE_BRAIN_MODEL,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: String(content || '') },
        finish_reason: 'stop',
      },
    ],
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad json' }) };
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const vapiCallId = String((body.call && body.call.id) || body.metadata && body.metadata.call_id || '');
  const callerPhone = String(
    (body.call && body.call.customer && body.call.customer.number) ||
    body.from || body.caller || ''
  );

  // Pre-fetch caller context (does nothing if phone empty)
  const prefetched = await prefetchCallerContext(callerPhone);

  // Build our system prompt + adapt the OpenAI messages
  const { history, userContent } = adaptOpenAIMessages(messages);
  const systemPrompt = buildSystemPrompt({ callerPhone, vapiCallId, prefetched });

  const ctx = {
    brain: 'phone_ant',
    signal_type: 'PHONE_CALL_TURN',
    critical: true,            // phone calls bypass soft spend cap — but not hard cap
    customer_id: prefetched && prefetched.customer && prefetched.customer.id || 0,
    phone: callerPhone,
    vapi_call_id: vapiCallId,
    purpose: 'inbound_phone_turn',
  };

  const result = await runBrainTurn({
    systemPrompt,
    userContent: userContent || '(call just connected — open the conversation)',
    history,
    tools: PHONE_BRAIN_TOOLS,
    ctx,
    maxIterations: 6,
    maxTokens: 600,           // tight — voice should be terse
    model: PHONE_BRAIN_MODEL,
    claudeTimeoutMs: 18_000,
  });

  // Spend gate may have blocked — return a graceful fallback so the
  // caller hears SOMETHING instead of dead air.
  if (result.error && result.error.startsWith('spend_gate_blocked')) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(openAIResponse({
        content: "I'm having trouble looking that up right now — let me get Teddy to call you back. What's the best number?",
        callId: vapiCallId,
      })),
    };
  }

  const reply = result.reply || 'Sorry, I missed that — can you say it again?';

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(openAIResponse({ content: reply, callId: vapiCallId })),
  };
};
