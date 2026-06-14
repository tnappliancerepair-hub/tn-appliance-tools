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
const { PHONE_TOOLS, UNIVERSAL_TOOLS, READ_TOOLS, pickTools } = require('./_lib/ant/tools');

const PHONE_BRAIN_MODEL = process.env.ANT_PHONE_MODEL || 'claude-sonnet-4-5-20250929';
const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

// Phone brain gets PHONE_TOOLS + a slice of UNIVERSAL_TOOLS (escalation
// + observation bus + capability flagging). No save_session_note (use
// update_customer_note instead — clearer ownership).
const PHONE_BRAIN_TOOLS = [
  ...PHONE_TOOLS,
  // search_customers (name/phone/address) lives in READ_TOOLS — the phone brain
  // needs it so it can find callers by NAME when the number is masked/unmatched.
  ...READ_TOOLS.filter((t) => ['search_customers'].includes(t.name)),
  ...UNIVERSAL_TOOLS.filter((t) => ['flag_capability_gap', 'record_brain_observation', 'load_brain_observations', 'review_before_ship'].includes(t.name)),
];

function buildSystemPrompt({ callerPhone, vapiCallId, prefetched, calledNumberContext }) {
  const known = prefetched && prefetched.customer;
  const openJobs = (prefetched && prefetched.open_jobs) || [];
  const lastCall = prefetched && prefetched.last_call_summary;

  const masked = prefetched && prefetched.caller_id_masked;
  const intro = masked
    ? `MASKED CALLER ID: the number that came through is one of OUR OWN lines (our phone system forwards calls and hides the real caller's number). You do NOT know who this is — do not guess or greet by name. Ask for their name and a claim or work-order number, then call lookup_by_claim_number. Could be a homeowner OR a warranty company.`
    : known
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
- DO NOT DIAGNOSE OR GIVE REPAIR ANSWERS TO THE CUSTOMER. Even if you have a strong idea what's wrong, never tell the homeowner what the problem is or how to fix it, and never read part numbers. Diagnosis is the tech's job. Instead say: "Let's get a tech out" or "send a photo of the model sticker and a quick video of the problem so our team can prep — that way we show up ready." (Any pre-diagnosis you form stays internal — it helps us bring the right part, it is not for the caller.)

SAFETY OVERRIDE:
- If caller describes gas leak / electrical hazard / active flooding / fire / medical: STOP. Tell them call 911 immediately. Then call mark_safety_emergency. Do NOT continue normal conversation until safety addressed.

FINDING THE CALLER (critical — do NOT dead-end):
- lookup_customer_by_phone runs automatically on connect. If it returns caller_id_masked:true or found:false, our line forwarded the call / they aren't matched by number yet — this is COMMON and does NOT mean they're a stranger.
- NEVER say "we can't find you in our system." Instead: "Happy to help — do you have a claim or work-order number? Or I can find you by name."
- If they give ANY number → call lookup_by_claim_number and read back the primary summary (status, scheduled day, tech).
- If they give a name → call search_customers (pass the FULL name). 1 match → confirm by city. Several → ask last name/city.
- Only after you've ACTUALLY called lookup_by_claim_number AND search_customers and both return nothing do you take a callback with request_callback. Never give up without calling the tools.

TOOLS — use them, don't pretend:
- lookup_by_claim_number — caller gives a claim / dispatch / work-order number → returns the job (status, scheduled day, tech, parts)
- search_customers — find a caller by NAME (or address) when the number is masked/unmatched
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

${renderCalledNumberContext(calledNumberContext)}

Call metadata: vapi_call_id=${vapiCallId}, inbound from ${callerPhone}.`;
}

function renderCalledNumberContext(ctx) {
  if (!ctx) return '';
  const lines = [];
  if (ctx.role && ctx.role !== 'unknown') lines.push(`CALLED-NUMBER ROLE: ${ctx.role}`);
  if (ctx.market_context) lines.push(`MARKET CONTEXT: ${ctx.market_context}`);
  if (ctx.callback_hint) lines.push(`CALLBACK HINT: ${ctx.callback_hint}`);
  if (ctx.tech_side) lines.push(`TECH-SIDE CALL: caller may be one of our techs. Cross-check caller_phone against the tech roster. If it matches a tech, switch to tech-assist context — no warm "what can I help you with"; lead with "what do you need?"`);
  return lines.length > 0 ? lines.join('\n') : '';
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
    if (!data || !data.found) return { customer: null, open_jobs: [], last_call_summary: '', caller_id_masked: !!(data && data.caller_id_masked) };

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

// Lightweight per-turn anger/distress detection. Flags emotional
// intensity so the brain can soften + auto-suggest escalation. Cheap
// regex pass — not perfect, fine for triage. If anger detected, we
// inject a SYSTEM hint into the system prompt for THIS turn.
function detectEmotionalIntensity(text) {
  if (!text) return { level: 'normal' };
  const t = String(text).toLowerCase();
  const angerSignals = [
    /\b(fuck|shit|damn|hell|wtf|bullshit|garbage|terrible|horrible|awful|stupid|incompetent|useless|worthless|sucks)\b/i,
    /\b(sue|lawyer|attorney|lawsuit|legal action|report|complain|complaint)\b/i,
    /\b(refund me|give me my money|cancel everything|never again|done with you)\b/i,
    /!{2,}/,
  ];
  const distressSignals = [
    /\b(gas leak|smell gas|fire|burning|flooding|water everywhere|electrical|sparks|emergency)\b/i,
    /\b(help me|please help|i need help|in trouble|scared|afraid)\b/i,
  ];
  for (const re of distressSignals) {
    if (re.test(t)) return { level: 'distress', reason: re.toString().slice(0, 60) };
  }
  let hits = 0;
  for (const re of angerSignals) { if (re.test(t)) hits += 1; }
  if (hits >= 2) return { level: 'anger_high', hits };
  if (hits === 1) return { level: 'anger_moderate', hits };
  return { level: 'normal' };
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

  // Pull called-number context from Vapi variableValues (seeded by
  // vapi-webhook.js buildAssistantConfig). Tells the brain WHICH of
  // our numbers was dialed and what that means for opening + tone.
  const cv = (body.call && body.call.variableValues) || {};
  const calledNumberContext = {
    role: cv.called_number_role || '',
    market_context: cv.called_number_market || '',
    callback_hint: cv.called_number_callback_hint || '',
    tech_side: !!cv.tech_side_call,
  };

  // Build our system prompt + adapt the OpenAI messages
  const { history, userContent } = adaptOpenAIMessages(messages);
  let systemPrompt = buildSystemPrompt({ callerPhone, vapiCallId, prefetched, calledNumberContext });

  // Per-turn sentiment check — appends a system hint when anger/distress
  // detected. Brain's prompt already covers safety triggers; this layer
  // adds tone-softening + escalation suggestion for anger.
  const intensity = detectEmotionalIntensity(userContent);
  if (intensity.level === 'distress') {
    systemPrompt += `\n\n⚠ DISTRESS DETECTED THIS TURN: caller may have a safety emergency. Re-read their last message. If gas/fire/electrical/flood/medical, call mark_safety_emergency immediately + tell them to call 911. If not safety, treat as high-emotion → soften tone, listen, offer escalate_to_human(target=teddy, urgency=high).`;
  } else if (intensity.level === 'anger_high') {
    systemPrompt += `\n\n⚠ HIGH ANGER DETECTED THIS TURN: caller is upset. Do NOT defend. Acknowledge directly ("That's really frustrating — I'm sorry"). Then offer a CONCRETE next step (escalate_to_human(target=teddy, urgency=high) is appropriate). Don't add chipper closers. Don't apologize 3 times — once + action.`;
  } else if (intensity.level === 'anger_moderate') {
    systemPrompt += `\n\nNote: caller's tone is somewhat irritated. Lead with acknowledgment, keep tone calm, focus on resolution.`;
  }

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
