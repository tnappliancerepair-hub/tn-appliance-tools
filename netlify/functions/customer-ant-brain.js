// Customer Ant brain — Claude with read-only customer-scoped tools.
// Customer is logged in via customer-portal.html; their phone_last4 +
// job_id are passed in on every call. The brain validates the phone
// against the job's customer before doing ANYTHING (defense in depth)
// and all tool queries are scoped to THIS customer's data only.
//
// Tone: warm, polite, brand-consistent (TN Appliance Exchange voice).
// No write tools yet — customer can REQUEST actions via the portal UI
// buttons (reschedule, send photos, etc.), Ant just helps them
// understand their job + history.
//
// Future write tools (after trust): request_reschedule, request_callback,
// add_note_to_my_job. All draft-then-confirm via portal UI.

const { runBrainTurn } = require('./_lib/ant/brain-core');
const { timedFetch, XANO_BASE, UNIVERSAL_TOOLS } = require('./_lib/ant/tools');

// Customer-facing brain. Switched to Haiku 4.5 for speed:
// Sonnet+tool turns were exceeding Netlify's default 10s function
// timeout, leaving the chat UI stuck in "thinking" forever. Carrie
// hit this twice. Haiku turn typical 1-3s vs 5-10s for Sonnet.
const CUSTOMER_MODEL_OVERRIDE = process.env.ANT_CUSTOMER_MODEL || 'claude-haiku-4-5-20251001';

// Headroom for cold start + one tool round-trip. Max sync timeout 26s.
exports.config = { timeout: 26 };

// Customer brain has its OWN tool set — scoped to one customer. Doesn't
// share with READ_TOOLS because those are office/tech-wide (could leak
// other customer data via search_customers, etc.).
const CUSTOMER_TOOLS = [
  {
    name: 'get_my_current_job',
    description: 'Get the full status of the customer\'s current job: appliance, scheduled time, assigned tech, what\'s wrong, what\'s been done. Call when the customer asks about their appointment, status, repair details, etc.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_my_repair_history',
    description: 'Get the customer\'s past repair history with us — every prior job, what was wrong, what we fixed. Call when they ask "have you been here before?" / "what did you do last time?" / "is this a recurring issue?"',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_my_blackouts',
    description: 'Get the list of times this customer has already told us they CAN\'T have a tech come. Call before adding a new blackout (so you know what\'s already there) and any time the customer asks "what did I already tell you" / "remind me of my availability."',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'add_blackout',
    description: 'Record a time the customer CAN\'T have a tech come. Use when they say things like "I work Mon-Fri 9 to 5" (recurring), "I\'m out Tuesday for a doctor visit" (one_time), "never before 10am" (recurring all weekdays with start_time). After calling, briefly read back what you captured ("Got it — Mon-Fri 9am-5pm, work hours") so they can correct.',
    input_schema: {
      type: 'object',
      properties: {
        blackout_type: {
          type: 'string',
          enum: ['one_time', 'recurring_weekly'],
          description: 'one_time = a specific date. recurring_weekly = a pattern (certain days of week, optionally with time range).'
        },
        description: { type: 'string', description: 'Plain-English description the customer would recognize, e.g. "work hours" or "kids\' soccer practice" or "doctor appointment".' },
        dow_csv: { type: 'string', description: 'Comma-separated days of week for recurring_weekly: any of mon,tue,wed,thu,fri,sat,sun. Use all weekdays as "mon,tue,wed,thu,fri" when the customer says "weekdays". Empty for one_time.' },
        start_time: { type: 'string', description: '24h HH:MM, e.g. "09:00" or "17:30". Empty for all-day blackouts.' },
        end_time: { type: 'string', description: '24h HH:MM. Empty for all-day blackouts.' },
        blackout_date: { type: 'string', description: 'YYYY-MM-DD for one_time blackouts. Empty for recurring_weekly.' },
        all_day: { type: 'boolean', description: 'true if the blackout is a whole day; false if only the start_time-end_time window.' },
      },
      required: ['blackout_type', 'description'],
    },
  },
  {
    name: 'remove_blackout',
    description: 'Remove a previously-recorded blackout. Use when the customer says "actually I can do Tuesday after all" or asks to delete one. Call list_my_blackouts first to get the blackout_id.',
    input_schema: {
      type: 'object',
      properties: {
        blackout_id: { type: 'string', description: 'The id field from list_my_blackouts (starts with "blk_").' },
      },
      required: ['blackout_id'],
    },
  },
  // Universal: capability gap escalation only. save_session_note +
  // load_relevant_notes are intentionally OFF for customer brain —
  // we don't want a customer-facing session reading or writing notes
  // about the customer (privacy + tone risk).
  ...UNIVERSAL_TOOLS.filter((t) => t.name === 'flag_capability_gap'),
];

async function executeCustomerTool(toolName, ctx, ti) {
  ti = ti || {};
  if (toolName === 'get_my_current_job') {
    return await timedFetch(`${XANO_BASE}/get_customer_job_view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: ctx.job_id, phone_last4: ctx.phone_last4 }),
    });
  }
  if (toolName === 'get_my_repair_history') {
    return await timedFetch(`${XANO_BASE}/get_my_repair_history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: ctx.job_id, phone_last4: ctx.phone_last4 }),
    });
  }
  if (toolName === 'list_my_blackouts') {
    const q = `job_id=${encodeURIComponent(ctx.job_id)}&phone_last4=${encodeURIComponent(ctx.phone_last4)}`;
    return await timedFetch(`${XANO_BASE}/list_customer_blackouts?${q}`, { method: 'GET' });
  }
  if (toolName === 'add_blackout') {
    return await timedFetch(`${XANO_BASE}/add_customer_blackout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: ctx.job_id,
        phone_last4: ctx.phone_last4,
        blackout_type: String(ti.blackout_type || 'one_time'),
        description: String(ti.description || '').slice(0, 200),
        dow_csv: String(ti.dow_csv || ''),
        start_time: String(ti.start_time || ''),
        end_time: String(ti.end_time || ''),
        blackout_date: String(ti.blackout_date || ''),
        all_day: ti.all_day === false ? false : true,
      }),
    });
  }
  if (toolName === 'remove_blackout') {
    return await timedFetch(`${XANO_BASE}/remove_customer_blackout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: ctx.job_id,
        phone_last4: ctx.phone_last4,
        blackout_id: String(ti.blackout_id || ''),
      }),
    });
  }
  if (toolName === 'flag_capability_gap') {
    const payload = {
      brain: 'customer_ant',
      user_request: String(ti.user_request || '').slice(0, 1500),
      gap_description: String(ti.gap_description || '').slice(0, 1500),
      proposed_solution: String(ti.proposed_solution || '').slice(0, 1500),
      ctx_customer_id: ctx.customer_id || null,
      ctx_job_id: ctx.job_id || null,
      flagged_at_ms: Date.now(),
    };
    await timedFetch(`${XANO_BASE}/record_event_log`, {
      method: 'POST',
      body: JSON.stringify({ action: 'brain_capability_gap', metadata_json: JSON.stringify(payload) }),
    });
    return { ok: true, message: 'Gap logged.' };
  }
  return { error: `unknown customer tool: ${toolName}` };
}

// Patch brain-core's tool execution by passing a custom executor. The
// shared brain-core calls executeTool from _lib/ant/tools, but we want
// the customer brain to use its own scoped executor. Simplest: run the
// loop here with the customer executor inlined. Slight duplication for
// safety isolation — worth it.
async function runCustomerBrainTurn({ systemPrompt, userContent, history, ctx, maxIterations = 4 }) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
  const MODEL = CUSTOMER_MODEL_OVERRIDE || 'claude-sonnet-4-5-20250929';
  if (!ANTHROPIC_KEY) return { reply: '', tool_calls: [], status: 0, error: 'ANTHROPIC_API_KEY not set' };

  const messages = [];
  for (const turn of (history || [])) {
    if (turn && turn.role && turn.content) messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: userContent });

  const toolCallsLog = [];
  let finalText = '';
  let lastStatus = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25_000);
    let resp;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1500,
          system: systemPrompt,
          tools: CUSTOMER_TOOLS,
          messages,
        }),
        signal: ac.signal,
      });
      clearTimeout(timer);
    } catch (err) {
      clearTimeout(timer);
      return { reply: '', tool_calls: toolCallsLog, status: 0, error: 'claude_call_failed: ' + (err.message || err) };
    }
    lastStatus = resp.status;
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      return { reply: '', tool_calls: toolCallsLog, status: resp.status, error: 'claude_non_2xx: ' + errBody.slice(0, 300) };
    }
    const data = await resp.json();
    const blocks = data.content || [];
    const toolUseBlocks = blocks.filter((b) => b.type === 'tool_use');
    const textBlocks = blocks.filter((b) => b.type === 'text');
    if (toolUseBlocks.length === 0) {
      finalText = textBlocks.map((b) => b.text).join('').trim();
      break;
    }
    messages.push({ role: 'assistant', content: blocks });
    const toolResults = [];
    for (const tu of toolUseBlocks) {
      const result = await executeCustomerTool(tu.name, ctx, tu.input || {});
      toolCallsLog.push({
        name: tu.name,
        result_summary: result.error ? 'error:' + result.error : 'ok:returned',
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result).slice(0, 16000),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return { reply: finalText, tool_calls: toolCallsLog, status: lastStatus };
}

function buildSystemPrompt() {
  return `You are Ant from TN Appliance Exchange — a friendly, helpful assistant for our customers. The person you're talking to is OUR CUSTOMER. You help them understand their repair appointment and answer questions about what we're doing for them.

YOUR PERSONALITY: warm, professional, brief. Like a helpful receptionist who knows the customer's account. Address them by first name when you know it. Never use jargon — translate technical terms.

WHAT YOU CAN HELP WITH:
- "When is my appointment?" → call get_my_current_job
- "Who's my tech?" → call get_my_current_job, share tech first name only
- "What's wrong with my fridge / what did you say I needed?" → call get_my_current_job
- "Have you been here before for this?" → call get_my_repair_history
- "What did you do last time?" → call get_my_repair_history
- "How long will the repair take?" → answer from current job if there's labor estimate; otherwise say you'll have the tech confirm
- "Are you running late?" → check current job; if you don't see updated ETA, say "I'll check with your tech" and direct them to text or call

WHAT TO REDIRECT:
- Reschedule requests → "I can pass that along. Use the 'Request Reschedule' button at the top of this page to send a specific time you'd prefer." (the portal UI handles the actual reschedule submission)
- Cancellation → "Tap the menu and choose Cancel, or call our office at 615-280-2949 — we want to make sure we handle it right."
- Pricing / payment / quotes → "Our office handles billing — best to call 615-280-2949 or message us back here and we'll have the right person reply."
- Complaints / disputes → "I'm sorry that's been your experience. I'm going to flag this for our office so the right person can call you back today."

WHAT NEVER TO DO:
- Don't promise prices, refunds, or discounts (only the office can)
- Don't share other customers' data (you only see this customer's account)
- Don't share the tech's personal phone number — just their first name
- Don't promise a specific time if you don't have one
- Don't say "I'll send a message to your tech" — you can't, the office handles that

### AVAILABILITY BLACKOUTS (this is your most important job in the portal)

We schedule differently from every other repair shop. Most shops ask "what time do you want, 9 or 12 or 3?" We don't. We ask the opposite: **when CAN'T we come?** The customer is fully available by default; their job is to LIST blackouts (constraints). The matcher then picks the soonest slot that doesn't conflict.

If the customer opens the portal chat with anything related to scheduling, availability, or "when can you come," lead them through capturing blackouts. Tools you'll use:

1. **list_my_blackouts** — call FIRST so you know what's already there. Don't ask the customer to re-tell you something they already said.
2. **add_blackout** — call any time the customer tells you a time they can't have us come. Read back what you captured so they can correct.
3. **remove_blackout** — call when they say "actually I CAN do Tuesday" or want to delete one.

How to translate what they say into add_blackout args:

| Customer says | blackout_type | dow_csv | start_time | end_time | blackout_date | all_day | description |
|---|---|---|---|---|---|---|---|
| "I work 9-5 Mon-Fri" | recurring_weekly | mon,tue,wed,thu,fri | 09:00 | 17:00 | | false | work hours |
| "Never before 10am" | recurring_weekly | mon,tue,wed,thu,fri,sat,sun | 00:00 | 10:00 | | false | mornings unavailable |
| "Out Tuesday June 9 for a doctor" | one_time | | | | 2026-06-09 | true | doctor appointment |
| "No Mondays" | recurring_weekly | mon | | | | true | no Mondays |
| "Wednesday afternoons busy" | recurring_weekly | wed | 12:00 | 17:00 | | false | Wednesday afternoons |
| "Weekends only" | recurring_weekly | mon,tue,wed,thu,fri | | | | true | weekdays unavailable |

After capturing, read it back in plain English and ask "anything else?" — most people have 0-2 blackouts. When they say no more, briefly summarize what's saved and tell them roughly what the math looks like:
- 0 blackouts → "We'll likely get a tech to you within 1-2 days."
- 1-2 blackouts → "We'll likely get a tech to you within 2-4 days."
- Heavy constraints → "With those windows, it might be closer to a week. We'll still do our best."

DO NOT promise specific dates. DO NOT try to book. Just capture blackouts. The matcher handles the actual scheduling.

If the customer says "anytime works" / "I'm wide open" / "no constraints" — that's the IDEAL answer. Call list_my_blackouts to confirm there are no existing ones, then say something like "Perfect — fully wide open is the fastest path. We'll get a tech to you ASAP."

REPLY FORMAT:
- Plain text, short, conversational
- No markdown headers, no asterisks
- 1-3 short paragraphs max
- End with a question if there's a logical follow-up`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad json' }) };
  }
  const job_id = parseInt(body.job_id || 0, 10);
  const phone_last4 = String(body.phone_last4 || '').replace(/\D/g, '').slice(-4);
  const message = (body.message || '').trim();
  if (!job_id || !phone_last4 || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'job_id + phone_last4 + message required' }) };
  }

  // Per-phone abuse gate — if this last4 + job combination triggers
  // >ANT_ABUSE_INBOUND_PER_HOUR calls in a rolling hour, refuse with
  // 429. Protects Claude spend from runaway customer scripts / bots.
  // Cold-start resets the in-memory counter (Netlify warm-instance
  // tradeoff — see spend.js).
  try {
    const { checkPhoneAbuseGate } = require('./_lib/ant/spend');
    const gate = checkPhoneAbuseGate(`${phone_last4}-${job_id}`);
    if (!gate.allow) {
      return { statusCode: 429, body: JSON.stringify({ error: 'too many requests', detail: gate.reason }) };
    }
  } catch (_) {}

  // Pre-flight: validate this customer can actually access this job (defense
  // in depth — the portal already validated, but never trust a client).
  // The same get_customer_job_view endpoint enforces the gate and returns
  // 4xx on mismatch, which we mirror.
  const authCheck = await timedFetch(`${XANO_BASE}/get_customer_job_view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id, phone_last4 }),
  });
  if (authCheck.error || (authCheck.err && authCheck.err.length)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized — phone_last4 mismatch or job not found' }) };
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const ctx = { job_id, phone_last4 };
  const result = await runCustomerBrainTurn({
    systemPrompt: buildSystemPrompt(),
    userContent: message,
    history,
    ctx,
  });

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: !result.error,
      reply: result.reply || '',
      tool_calls: result.tool_calls || [],
      status: result.status || 0,
      error: result.error || null,
    }),
  };
};
