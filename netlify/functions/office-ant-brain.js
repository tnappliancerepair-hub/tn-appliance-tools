// Office Ant brain — Claude with tools for Teddy / Danielle / Alyse.
// Same architecture as tech-assist-brain.js: multi-turn tool-calling
// loop where Claude can fetch real data before composing answers.
//
// Tools focus on office-side decisions: what needs human action, who's
// overloaded, what's in the warranty queue, customer history for
// scheduling decisions, model-specific failure data for diagnoses.
//
// Caller (office-ant.js widget) sends:
//   { user_role: 'owner'|'warranty'|'finance', message, history? }
// Brain returns:
//   { ok, reply, tool_calls, status }

const XANO_BASE = process.env.XANO_INTAKE_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOOL_ITERATIONS = 6;     // office tasks can need more lookups than tech-side
const CLAUDE_TIMEOUT_MS = 30_000;
const TOOL_FETCH_TIMEOUT_MS = 10_000;

// ─── Tool definitions ───────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_office_todo',
    description: 'Get the prioritized list of things that need a human in the office to take action: stale intake jobs awaiting parallel-mode scheduling, held jobs, parts that have arrived (need to call customer to schedule second visit), warranty completions blocked on incomplete TDR, callbacks. Use when asked "what should I work on?" or "what needs attention?"',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_needs_scheduled_queue',
    description: 'Get jobs in the parallel-mode Needs Scheduled queue — jobs that landed via warranty email (AHS, ServicePower, Allstate) and need someone to assign a tech + time. Used for Danielle\'s scheduling workflow.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max jobs to return (default 25)' },
      },
      required: [],
    },
  },
  {
    name: 'get_calendar_week',
    description: 'Get the office calendar overview for a week — jobs per tech per day with capacity indicators (color-coded: green 0-2, yellow 3-4, red 5-6, gray day-off). Used for scheduling decisions: "is Jimmy overloaded Thursday?" "who has capacity tomorrow?" "what does next week look like?"',
    input_schema: {
      type: 'object',
      properties: {
        week_start_ms: { type: 'integer', description: 'Optional week start (Monday) in unix ms. Defaults to current week.' },
        region: { type: 'string', description: 'Optional region filter: "tn" or "la"' },
      },
      required: [],
    },
  },
  {
    name: 'get_tech_performance',
    description: 'Get a tech\'s performance metrics over a period: jobs completed, first-visit-fix rate, average time per job, recent jobs. Use when asked about a tech\'s recent work or when deciding who to assign a job to.',
    input_schema: {
      type: 'object',
      properties: {
        tech_id: { type: 'integer', description: 'Required: which tech (1=Teddy, 2=Jimmy, 3=Andre, 4=Lee, 5=Billy, 6=John)' },
        days: { type: 'integer', description: 'Days back to summarize (default 30)' },
      },
      required: ['tech_id'],
    },
  },
  {
    name: 'get_customer_service_history',
    description: 'Get prior service history for a customer (every job we have done for them, with diagnosis + repair + tech). Use when looking up a recurring customer or before scheduling a follow-up.',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'integer', description: 'Required customer ID' },
        exclude_job_id: { type: 'integer', description: 'Optional: omit one job from results' },
        limit: { type: 'integer', description: 'Max prior jobs (default 10)' },
      },
      required: ['customer_id'],
    },
  },
  {
    name: 'get_common_failures_for_model',
    description: 'Get the most common failure modes for a brand + appliance combination, based on every TDR we have. Returns top failed components + likely part numbers + frequency. Useful when reviewing a job\'s symptoms or pre-diagnosis.',
    input_schema: {
      type: 'object',
      properties: {
        brand: { type: 'string', description: 'Brand name (e.g. LG, Whirlpool, GE)' },
        appliance_type: { type: 'string', description: 'Appliance type (refrigerator, dryer, etc.)' },
        model_number: { type: 'string', description: 'Optional model number' },
      },
      required: ['brand', 'appliance_type'],
    },
  },
  {
    name: 'get_office_pulse',
    description: 'Get the live activity feed from the colony loop — last N significant events (jobs created, TDRs saved, signals processed, errors). Use to answer "what just happened?" or to investigate something recent.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max events to return (default 30)' },
      },
      required: [],
    },
  },
  {
    name: 'search_customers',
    description: 'Search the customer database by phone, name, address, or email. Returns up to 25 matches with their most recent job. Use to look up "the Smith on Belle Meade" or "did we ever do work for 615-555-1234".',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text — phone number, name, address fragment, etc.' },
      },
      required: ['query'],
    },
  },
];

// ─── Tool execution ─────────────────────────────────────────────────
async function executeTool(toolName, toolInput) {
  const fetchJSON = async (url) => await timedFetch(url, { method: 'GET' });
  switch (toolName) {
    case 'get_office_todo':
      return await fetchJSON(`${XANO_BASE}/get_office_todo`);
    case 'get_needs_scheduled_queue': {
      const limit = toolInput.limit || 25;
      return await fetchJSON(`${XANO_BASE}/list_needs_scheduled_parallel?limit=${limit}`);
    }
    case 'get_calendar_week': {
      const qs = [];
      if (toolInput.week_start_ms) qs.push(`week_start_ms=${toolInput.week_start_ms}`);
      if (toolInput.region) qs.push(`region=${encodeURIComponent(toolInput.region)}`);
      return await fetchJSON(`${XANO_BASE}/get_office_calendar_week${qs.length ? '?' + qs.join('&') : ''}`);
    }
    case 'get_tech_performance': {
      if (!toolInput.tech_id) return { error: 'tech_id required' };
      const days = toolInput.days || 30;
      return await fetchJSON(`${XANO_BASE}/get_tech_performance?tech_id=${toolInput.tech_id}&days=${days}`);
    }
    case 'get_customer_service_history': {
      if (!toolInput.customer_id) return { error: 'customer_id required' };
      const qs = `customer_id=${toolInput.customer_id}&limit=${toolInput.limit || 10}` + (toolInput.exclude_job_id ? `&exclude_job_id=${toolInput.exclude_job_id}` : '');
      return await fetchJSON(`${XANO_BASE}/assist_get_customer_history?${qs}`);
    }
    case 'get_common_failures_for_model': {
      const brand = encodeURIComponent(toolInput.brand || '');
      const appl = encodeURIComponent(toolInput.appliance_type || '');
      const model = encodeURIComponent(toolInput.model_number || '');
      return await fetchJSON(`${XANO_BASE}/get_common_failures?brand=${brand}&appliance_type=${appl}&model_number=${model}&per_page=10`);
    }
    case 'get_office_pulse': {
      const limit = toolInput.limit || 30;
      return await fetchJSON(`${XANO_BASE}/get_office_pulse?limit=${limit}`);
    }
    case 'search_customers': {
      if (!toolInput.query) return { error: 'query required' };
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), TOOL_FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(`${XANO_BASE}/office_universal_search?q=${encodeURIComponent(toolInput.query)}`, { method: 'GET', signal: ac.signal });
        clearTimeout(t);
        if (!res.ok) return { error: `HTTP ${res.status}` };
        return await res.json();
      } catch (err) {
        clearTimeout(t);
        return { error: err.name === 'AbortError' ? 'timeout' : (err.message || String(err)) };
      }
    }
    default:
      return { error: `unknown tool: ${toolName}` };
  }
}

async function timedFetch(url, opts) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TOOL_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (err) {
    clearTimeout(t);
    return { error: err.name === 'AbortError' ? 'timeout' : (err.message || String(err)) };
  }
}

// ─── System prompt ──────────────────────────────────────────────────
function buildSystemPrompt(ctx) {
  const todayCt = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'full', timeStyle: 'short' });
  return `You are Ant, the office assistant for TN Appliance Exchange — an appliance-repair business based in Tennessee with a second region in Louisiana. You help the OFFICE side (owner Teddy, warranty handler Danielle, and finance Alyse) make faster + better decisions.

CURRENT TIME: ${todayCt} CT

ACTIVE TECHS (id → name → phone → region):
1 Teddy Pivacek (owner, 615-485-5795, Antioch TN)
2 Jimmy Pivacek (615-967-1304, South Nashville)
3 Andre Pivacek (615-969-3115, dual-state TN+LA, based Hammond LA)
4 Lee Harding (615-829-1654, Clarksville TN)
5 Billy Savoy (731-504-9617, Hammond LA)
6 John Houk (813-352-7686, Walker LA)

TOOLS: you have read access to the live business — jobs queue, calendar, tech performance, customer history, common failure data, pulse feed, customer search. CALL TOOLS to answer with real data, not guesses. Multiple tool calls per turn are fine and expected.

PRINCIPLES:
- Be direct + brief. The user is busy. No greetings, no filler, no "I'd be happy to help."
- Lead with the answer. If they ask "who's overloaded?", first line is "Lee — 6 jobs Tuesday."
- Show your sources lightly. "(per calendar week)" or "(2 prior visits)" rather than long preambles.
- When a decision is involved, give a recommendation + the alternative. "Assign to Jimmy — closest to zip 37013 + has only 2 jobs. Andre is also available if you want LA-region balance."
- If a tool returns nothing or errors, say so plainly. Don't invent.
- Use plain text. No markdown headers. Modest use of - bullet points OK. Phone-friendly width.
- For questions about specific jobs, fetch via search_customers or get_customer_service_history.
- When asked "what should I work on", call get_office_todo first.

DO NOT:
- Make up customer names, job IDs, or numbers
- Apologize unless you actually made an error
- Suggest features that don't exist
- Recommend calling a phone number unless you got it from a tool result`;
}

// ─── Multi-turn Claude call with tool loop ──────────────────────────
async function callClaudeWithTools(systemPrompt, userMessage, history) {
  // Build messages: history (prior turns) + current message
  const messages = [];
  if (Array.isArray(history)) {
    for (const turn of history) {
      if (turn && turn.role && turn.content) {
        messages.push({ role: turn.role, content: turn.content });
      }
    }
  }
  messages.push({ role: 'user', content: userMessage });

  const toolCallsLog = [];
  let finalText = '';
  let lastStatus = 0;

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const claudeAc = new AbortController();
    const claudeT = setTimeout(() => claudeAc.abort(), CLAUDE_TIMEOUT_MS);
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
          max_tokens: 2000,
          system: systemPrompt,
          tools: TOOLS,
          messages,
        }),
        signal: claudeAc.signal,
      });
      clearTimeout(claudeT);
    } catch (err) {
      clearTimeout(claudeT);
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
      const result = await executeTool(tu.name, tu.input || {});
      toolCallsLog.push({
        name: tu.name,
        input: tu.input,
        result_summary: result.error
          ? 'error:' + result.error
          : `ok:${result.count != null ? result.count + ' items' : (result.items ? result.items.length + ' items' : 'returned')}`,
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

// ─── Netlify handler ───────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  if (!ANTHROPIC_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad json' }) };
  }
  const message = (body.message || '').trim();
  if (!message) return { statusCode: 400, body: JSON.stringify({ error: 'message required' }) };
  const history = Array.isArray(body.history) ? body.history : [];
  const sys = buildSystemPrompt({ user_role: body.user_role || 'owner' });
  const result = await callClaudeWithTools(sys, message, history);
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
