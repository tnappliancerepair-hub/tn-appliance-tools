// PHONE ANT OUTBOUND — single brain replacing 7 static outbound agents
//
// We were paying for + maintaining 7 separate Vapi agents:
//   - Warranty Fallback (2hr after warranty job, no form yet)
//   - Parts Follow-Up (parts arrived → offer 3 slots)
//   - Appointment Reminder (day-before reminder)
//   - Missed Call Callback (sub-2-min return after missed inbound)
//   - Authorization Update (warranty auth approved/denied/pending)
//   - Parts ETA Update (parts ordered + ETA delivery)
//   - Tech Running Late (late ETA + reschedule offer)
//
// All 7 had similar SHAPE (opening + main message + branching + wrap)
// but separate static prompts. This brain handles all 7 (and any
// future outbound) with one source-of-truth prompt that LOADS the
// scenario context at call-start.
//
// Vapi assistant-request callers pass `purpose` + `customer_id` +
// `job_id` (optional). We pre-fetch full context, build a
// scenario-specific system prompt, and let brain-core handle the
// turn-by-turn conversation.
//
// Architecture: identical to phone-ant-brain.js (inbound) but the
// system prompt is scenario-tailored. Same tool surface — the agent
// can send links, book appointments, escalate, capture preferences,
// flag capability gaps. Same outcome tracking.

const { runBrainTurn } = require('./_lib/ant/brain-core');
const { PHONE_TOOLS, UNIVERSAL_TOOLS } = require('./_lib/ant/tools');

const PHONE_OUTBOUND_MODEL = process.env.ANT_PHONE_OUTBOUND_MODEL || process.env.ANT_PHONE_MODEL || 'claude-sonnet-4-5-20250929';
const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

const PHONE_OUT_TOOLS = [
  ...PHONE_TOOLS,
  ...UNIVERSAL_TOOLS.filter((t) => ['flag_capability_gap', 'record_brain_observation', 'load_brain_observations', 'review_before_ship'].includes(t.name)),
];

// Scenario → opening line + role-specific guidance. The shared rules
// (warm tone, no scripted closers, escalate when stuck) come from the
// base prompt below.
const SCENARIOS = {
  warranty_fallback: {
    open_template: (ctx) => `Hey ${ctx.first_name || 'there'}, this is Ant calling from TN Appliance Exchange — we got your ${ctx.warranty_company || 'warranty'} claim and just wanted to follow up since we didn't see your details come through online. Do you have a couple minutes?`,
    role: 'You are calling because the customer was assigned to us through their warranty company but hasn\'t filled out our intake form. Your goal: collect appliance details verbally (type, brand, problem), get a scheduling preference window, and SMS them the resume-chat link via send_customer_a_link so they can confirm the rest. If they\'re busy: request_callback for a better time. Don\'t force them through 10 questions on the phone — capture what you can + text the link.',
  },
  parts_followup: {
    open_template: (ctx) => `Hey ${ctx.first_name || 'there'}, this is Ant from TN Appliance Exchange — good news, the part for your ${ctx.appliance_type || 'appliance'} just came in. ${ctx.tech_first_name || 'Your tech'} can get back out this week, what works best for you?`,
    role: 'You\'re calling because parts arrived for an active job. Goal: book a return-visit slot. Pull get_open_jobs_for_customer to know which job + which tech. Use load_brain_observations to see if the customer recently asked about timing. Confirm a specific day + window. After booking: send_customer_a_link type=portal so they have the new appointment time. If they need to reschedule the whole thing: escalate_to_human(target=danielle).',
  },
  appointment_reminder: {
    open_template: (ctx) => `Hey ${ctx.first_name || 'there'}, this is Ant from TN Appliance Exchange — just a quick reminder ${ctx.tech_first_name || 'your tech'} is heading out tomorrow ${ctx.window_ct || ''} for your ${ctx.appliance_type || 'appliance'}. Still good?`,
    role: 'You\'re calling the day before an appointment. Goal: confirm + capture access details (gate code, dog, garage code, parking). 90-sec target. If yes: collect access notes via update_customer_note. If no: offer to reschedule via request_callback(target=danielle). Don\'t leave voicemail — if no answer, end gracefully and the system will SMS the reminder instead.',
  },
  missed_call_callback: {
    open_template: (ctx) => `Hey, this is Ant from TN Appliance Exchange returning your call — what can I help you with?`,
    role: 'You\'re calling back within 2 minutes of a missed inbound call. The caller may or may not be in our records — call lookup_customer_by_phone with their number if you don\'t already have context. Branch by intent (warranty / self-pay / question / wrong number). Mirror inbound brain\'s capabilities.',
  },
  authorization_update: {
    open_template: (ctx) => `Hey ${ctx.first_name || 'there'}, this is Ant from TN Appliance Exchange with an update on your ${ctx.warranty_company || 'warranty'} claim. ${ctx.authorization_status === 'approved' ? 'Great news — you\'re approved.' : ctx.authorization_status === 'denied' ? 'Unfortunately the claim was denied — let me walk you through what that means.' : 'Your claim is still pending review.'} Do you have a minute?`,
    role: 'You\'re delivering a warranty authorization status. Goal: deliver the status clearly + book next steps. If approved: book repair slot. If denied: offer self-pay quote or escalate_to_human(target=danielle) for appeal options. If pending: set expectations ("3-5 business days") + book conditional slot.',
  },
  parts_eta_update: {
    open_template: (ctx) => `Hey ${ctx.first_name || 'there'}, this is Ant from TN Appliance Exchange — the part for your ${ctx.appliance_type || 'appliance'} has been ordered and should arrive ${ctx.parts_eta_ct || 'this week'}. Just wanted to keep you posted.`,
    role: 'You\'re delivering a parts ETA. 60-sec target. Confirm they\'re aware. If they have questions about timing or want a different option: handle from get_open_jobs_for_customer + send_customer_a_link(type=portal).',
  },
  tech_running_late: {
    open_template: (ctx) => `Hey ${ctx.first_name || 'there'}, this is Ant from TN Appliance Exchange. Quick heads up — ${ctx.tech_first_name || 'your tech'} is running about ${ctx.minutes_late || 30} minutes behind schedule. New ETA is ${ctx.new_eta_ct || 'around'}. Does that still work for you?`,
    role: 'You\'re apologizing for a tech running late. 90-sec target. Tone: apologetic, no excuses. Options: (1) still works → confirm new time + send_customer_a_link(type=tracking). (2) doesn\'t work → offer to reschedule via request_callback(target=danielle). NEVER promise an exact-to-the-minute ETA — use windows.',
  },
};

function buildSystemPrompt({ purpose, ctx, callerVars }) {
  const sc = SCENARIOS[purpose] || SCENARIOS.missed_call_callback;
  const openHint = sc.open_template(callerVars);

  const customerLine = ctx.customer
    ? `KNOWN CALLER: ${ctx.customer.first_name || ''} ${ctx.customer.last_name || ''} (customer_id=${ctx.customer.id}). Comms style: ${ctx.customer.intel_style || 'unknown'}. Language: ${ctx.customer.intel_language || 'en'}.`
    : `Customer NOT in records (rare for outbound — verify customer_id passed in is correct).`;

  const jobLine = ctx.job
    ? `TARGET JOB: #${ctx.job.id} — ${ctx.job.appliance_type || 'appliance'}${ctx.job.brand ? ' (' + ctx.job.brand + ')' : ''} | scheduled: ${ctx.job.scheduled_start_ct || 'unscheduled'} | tech: ${ctx.job.tech_first_name || 'unassigned'} | parts: ${ctx.job.parts_status || 'n/a'}`
    : '';

  return `You are Ant — the AI receptionist for TN Appliance Exchange making an OUTBOUND call. Owner: Teddy Pivacek. Service area: Middle Tennessee + parts of Louisiana.

NAME PRONUNCIATION: Ant rhymes with "can't" (pronounced like the insect — Anthony tribute).

OUTBOUND CALL RULES:
- You DIALED them. Open with WHY you're calling within 5 seconds. Don't make them ask "what's this about."
- Suggested opening line for this scenario: "${openHint}" — adapt to fit, don't read robotically.
- Respect their time. Keep total under 90 seconds unless they ask follow-up questions.
- If they're driving / busy / can't talk: confirm a callback via request_callback. Don't push.
- If voicemail picked up: leave a short message + send_customer_a_link(type=portal) as the follow-up.

SCENARIO: ${purpose}
${sc.role}

ABSOLUTE RULES:
- Never promise actions you didn't actually take (no "I'll text you" without calling send_customer_a_link first).
- If you don't have the answer: escalate_to_human OR request_callback. Don't bullshit.
- One sentence opens, two sentence replies. They're on the PHONE.
- Read-back confirm bookings: "So I've got Thursday between 1 and 3 — that right?"

SAFETY OVERRIDE: if customer mentions gas leak / electrical hazard / flooding / fire / medical → call mark_safety_emergency, tell them to call 911, end the conversation immediately.

${customerLine}
${jobLine}`;
}

async function loadOutboundContext({ customer_id, job_id }) {
  const out = { customer: null, job: null };
  if (customer_id) {
    try {
      const r = await fetch(`${XANO_BASE}/lookup_customer_by_phone?phone=customer_id_${customer_id}`, { signal: AbortSignal.timeout(4000) });
      // Fallback path: customer_id-based lookup
      if (!r.ok) {
        // No customer-id-based lookup endpoint; try open jobs which returns customer info indirectly
      } else {
        const d = await r.json();
        if (d && d.found && d.customer) out.customer = d.customer;
      }
    } catch (_) {}
  }
  if (job_id) {
    try {
      const r = await fetch(`${XANO_BASE}/get_open_jobs_for_customer?customer_id=${customer_id || 0}`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const d = await r.json();
        const targetJob = (d.items || []).find((j) => Number(j.id) === Number(job_id));
        if (targetJob) out.job = targetJob;
      }
    } catch (_) {}
  }
  return out;
}

function adaptOpenAIMessages(messages) {
  const history = [];
  let lastUser = '';
  for (const m of messages) {
    if (!m || !m.role) continue;
    if (m.role === 'system') continue;
    if (m.role === 'user') { history.push({ role: 'user', content: String(m.content || '') }); lastUser = String(m.content || ''); }
    else if (m.role === 'assistant') history.push({ role: 'assistant', content: String(m.content || '') });
  }
  if (history.length > 0 && history[history.length - 1].role === 'user') {
    lastUser = history.pop().content;
  }
  return { history, userContent: lastUser };
}

function openAIResponse({ content, callId, modelLabel }) {
  return {
    id: `chatcmpl-${callId || Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelLabel || PHONE_OUTBOUND_MODEL,
    choices: [{ index: 0, message: { role: 'assistant', content: String(content || '') }, finish_reason: 'stop' }],
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 400, body: JSON.stringify({ error: 'bad json' }) }; }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const vapiCallId = String((body.call && body.call.id) || '');
  const calledNumber = String((body.call && body.call.customer && body.call.customer.number) || body.to || '');

  // Vapi passes our seeded variables in the call.variableValues object
  const vars = (body.call && body.call.variableValues) || body.variables || {};
  const purpose = String(vars.purpose || 'missed_call_callback').toLowerCase();
  const customerId = Number(vars.customer_id || 0);
  const jobId = Number(vars.job_id || 0);

  const ctx = await loadOutboundContext({ customer_id: customerId, job_id: jobId });
  const callerVars = {
    first_name: vars.first_name || (ctx.customer && ctx.customer.first_name) || '',
    appliance_type: vars.appliance_type || (ctx.job && ctx.job.appliance_type) || '',
    tech_first_name: vars.tech_first_name || (ctx.job && ctx.job.tech_first_name) || '',
    warranty_company: vars.warranty_company || (ctx.job && ctx.job.warranty_company) || '',
    authorization_status: vars.authorization_status || '',
    parts_eta_ct: vars.parts_eta_ct || '',
    minutes_late: vars.minutes_late || 30,
    new_eta_ct: vars.new_eta_ct || '',
    window_ct: vars.window_ct || '',
  };

  const { history, userContent } = adaptOpenAIMessages(messages);
  const systemPrompt = buildSystemPrompt({ purpose, ctx, callerVars });

  const brainCtx = {
    brain: 'phone_ant_outbound',
    signal_type: `PHONE_OUTBOUND_${purpose.toUpperCase()}`,
    critical: true,
    customer_id: customerId,
    job_id: jobId,
    phone: calledNumber,
    vapi_call_id: vapiCallId,
    purpose: `outbound_${purpose}`,
  };

  const result = await runBrainTurn({
    systemPrompt,
    userContent: userContent || '(start of outbound call — open the conversation per the scenario)',
    history,
    tools: PHONE_OUT_TOOLS,
    ctx: brainCtx,
    maxIterations: 6,
    maxTokens: 500,
    model: PHONE_OUTBOUND_MODEL,
    claudeTimeoutMs: 18_000,
  });

  if (result.error && result.error.startsWith('spend_gate_blocked')) {
    return ok(openAIResponse({ content: 'I appreciate your time — Teddy will give you a quick call later this week. Take care.', callId: vapiCallId }));
  }
  return ok(openAIResponse({ content: result.reply || 'Got it — thanks for picking up. Talk soon.', callId: vapiCallId }));
};

function ok(body) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
