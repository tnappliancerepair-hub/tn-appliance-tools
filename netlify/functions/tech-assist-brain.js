// Ant Assist brain — the Claude tool-calling layer that turns the
// passive scribe into an actual teammate.
//
// Same Sonnet 4.5 model as before, but now with HANDS: Claude can call
// tools to fetch customer service history, model common-failures, etc.
// before composing its reply. Returns the same {reply, captured} shape
// the XS endpoint expects, so the swap is transparent.
//
// Why a Netlify function instead of XS:
//   - Tool-calling loop is multi-turn (call Claude → get tool_use blocks
//     → execute tools → send tool_result back → loop). XS has no clean
//     way to do this without try/catch or while loops, both of which
//     are footguns or unsupported.
//   - Node lets us run the loop cleanly with fetch + JSON.parse.
//
// Caller (tech_sms_assist_POST.xs) sends:
//   { tech_id, tech_first_name, job_id, brand, appliance, problem,
//     existing_captured, message, media_urls? }
// Brain returns:
//   { ok: bool, reply: string, captured: object, tool_calls: array, status }

const XANO_BASE = process.env.XANO_INTAKE_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOOL_ITERATIONS = 4;     // Claude can call tools up to 4 times per turn before we cut it off
const CLAUDE_TIMEOUT_MS = 25_000;
const TOOL_FETCH_TIMEOUT_MS = 8_000;

// ─── Tool definitions ───────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_customer_service_history',
    description: 'Get prior service history for the current customer (jobs we have done before for them, with diagnosis and what was fixed). Call this when the tech might benefit from knowing what has been done at this customer house before — e.g. when diagnosing a recurring problem or before quoting a repair. Excludes the current job.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max prior jobs to return (default 10, max 25)' },
      },
      required: [],
    },
  },
  {
    name: 'get_common_failures_for_model',
    description: 'Get the most common failure modes for this brand + appliance type, based on every TDR our techs have ever submitted. Returns the top failed components + likely part numbers + frequency. Call this when narrowing down a diagnosis on a model you have seen before, or when suggesting what to check first.',
    input_schema: {
      type: 'object',
      properties: {
        brand: { type: 'string', description: 'Brand name (e.g. LG, Whirlpool, GE)' },
        appliance_type: { type: 'string', description: 'Appliance type (refrigerator, dryer, range, etc.)' },
        model_number: { type: 'string', description: 'Optional: full model number for more specific results' },
      },
      required: ['brand', 'appliance_type'],
    },
  },
];

// ─── Tool execution ─────────────────────────────────────────────────
async function executeTool(toolName, toolInput, ctx) {
  if (toolName === 'get_customer_service_history') {
    if (!ctx.customer_id) return { error: 'no customer_id in context' };
    const url = `${XANO_BASE}/assist_get_customer_history?customer_id=${ctx.customer_id}&exclude_job_id=${ctx.job_id}&limit=${toolInput.limit || 10}`;
    return await timedFetch(url, { method: 'GET' });
  }
  if (toolName === 'get_common_failures_for_model') {
    const brand = encodeURIComponent(toolInput.brand || ctx.brand || '');
    const appl = encodeURIComponent(toolInput.appliance_type || ctx.appliance || '');
    const model = encodeURIComponent(toolInput.model_number || '');
    const url = `${XANO_BASE}/get_common_failures?brand=${brand}&appliance_type=${appl}&model_number=${model}&per_page=10`;
    return await timedFetch(url, { method: 'GET' });
  }
  return { error: `unknown tool: ${toolName}` };
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
  return `You are Ant, the silent scribe + smart teammate for an appliance-repair tech mid-job. Hands dirty, on the road. NOT a chatbot — you only speak when you have real value to add.

OUTPUT FORMAT: respond with valid JSON only, no markdown fence:
{"reply":"<under-250-char plain text or empty string>","captured":{"diagnosis":string?,"failed_component":string?,"verified_part_number":string?,"replaced_by_part_number":string?,"labor_hours":string?,"repair_completed":string?,"parts_status":string?,"recommendation":string?}}

TOOLS AVAILABLE: you can call get_customer_service_history and get_common_failures_for_model to look up real data. USE THEM when relevant — e.g.:
- Tech says "this is the third time I've been here" → call get_customer_service_history
- Tech is diagnosing → call get_common_failures_for_model to see what others have found
- Tech asks "what does this customer usually have?" → call get_customer_service_history
DON'T call tools just to look smart — only when the data would change your reply.

EXTRACTION RULES (every turn, parse the LATEST message for ALL fields):
- '1.5', '45 min', '1 hr', '2hrs' → labor_hours as decimal ('1.5', '0.75', '1', '2')
- 'replaced by #X' / 'sub X' / 'crossed to X' → replaced_by_part_number=X
- Part numbers like 'WPW10310240', '316455400' → verified_part_number
- 'all done' / 'fixed' / 'swapped' → recommendation='repair_complete' + repair_completed describing what they did
- 'parts ordered' / 'on order' → parts_status='ordered', recommendation='2nd_visit'
- 'Nwt' / 'NWT' → parts_status='needs_quote', recommendation='quote'

REPLY RULES:
- ALL 4 core fields present (diagnosis, failed_component, labor_hours, repair_completed) → reply: "TDR saved. <one-sentence summary>."
- EXACTLY ONE core field missing → ask for ONLY that one, briefly. "Still need labor hours."
- TWO+ missing → list them in one message. "Still need: failed part, labor hours."
- Tech asks part lookup → respond IMMEDIATELY with searspartsdirect.com/model/<MODEL>/parts link. NEVER promise to "look it up" or "grab it" — link IS the deliverable.
- NEVER say "got it" / "keep going" / "text more findings" — if nothing to add, reply is empty string "".
- NEVER ask for a field already in 'Already captured'.
- Photos: when tech sends image, READ IT. Extract model/serial/part/error code.

JOB CONTEXT: tech=${ctx.tech_first_name} job#${ctx.job_id} appliance=${ctx.brand} ${ctx.appliance} problem=${ctx.problem}
Already captured: ${JSON.stringify(ctx.existing_captured || {})}`;
}

// ─── Multi-turn Claude call with tool loop ──────────────────────────
async function callClaudeWithTools(systemPrompt, userContent, ctx) {
  const messages = [{ role: 'user', content: userContent }];
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
          max_tokens: 1500,
          system: systemPrompt,
          tools: TOOLS,
          messages,
        }),
        signal: claudeAc.signal,
      });
      clearTimeout(claudeT);
    } catch (err) {
      clearTimeout(claudeT);
      return { reply: '', captured: {}, tool_calls: toolCallsLog, status: 0, error: 'claude_call_failed: ' + (err.message || err) };
    }
    lastStatus = resp.status;
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      return { reply: '', captured: {}, tool_calls: toolCallsLog, status: resp.status, error: 'claude_non_2xx: ' + errBody.slice(0, 300) };
    }
    const data = await resp.json();
    const blocks = data.content || [];
    const toolUseBlocks = blocks.filter((b) => b.type === 'tool_use');
    const textBlocks = blocks.filter((b) => b.type === 'text');
    if (toolUseBlocks.length === 0) {
      // No tool calls — Claude is done, return its text
      finalText = textBlocks.map((b) => b.text).join('').trim();
      break;
    }
    // Append assistant turn (full content), then execute each tool and append a tool_result
    messages.push({ role: 'assistant', content: blocks });
    const toolResults = [];
    for (const tu of toolUseBlocks) {
      const result = await executeTool(tu.name, tu.input || {}, ctx);
      toolCallsLog.push({ name: tu.name, input: tu.input, result_summary: result.success === false || result.error ? 'error:' + (result.error || 'unknown') : `ok:${result.count != null ? result.count + ' items' : 'returned'}` });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result).slice(0, 8000),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  // Parse the final text as JSON (Claude's spec response)
  let reply = '';
  let captured = {};
  if (finalText) {
    const cleaned = finalText.replace(/```json/g, '').replace(/```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      reply = (parsed.reply || '').trim();
      captured = parsed.captured || {};
    } catch (_) {
      // Claude returned non-JSON despite the prompt. Use raw text as reply.
      reply = cleaned;
    }
  }
  return { reply, captured, tool_calls: toolCallsLog, status: lastStatus };
}

// ─── Netlify handler ───────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'POST only' };
  }
  if (!ANTHROPIC_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
  }
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad json' }) };
  }
  const ctx = {
    tech_id: body.tech_id,
    tech_first_name: body.tech_first_name || '',
    job_id: body.job_id,
    customer_id: body.customer_id,
    brand: body.brand || '',
    appliance: body.appliance || 'appliance',
    problem: body.problem || '',
    existing_captured: body.existing_captured || {},
  };
  // Build user content. Media URLs become image blocks (Claude vision URL form).
  const mediaUrls = Array.isArray(body.media_urls) ? body.media_urls.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)) : [];
  const textBody = (body.message || '').trim();
  let userContent;
  if (mediaUrls.length > 0) {
    userContent = [];
    for (const u of mediaUrls) {
      userContent.push({ type: 'image', source: { type: 'url', url: u } });
    }
    if (textBody) {
      userContent.push({ type: 'text', text: textBody });
    } else {
      userContent.push({ type: 'text', text: '(Tech sent a photo with no caption — extract any visible model/serial/part/error code text and treat as TDR fields.)' });
    }
  } else {
    userContent = textBody;
  }
  const systemPrompt = buildSystemPrompt(ctx);
  const result = await callClaudeWithTools(systemPrompt, userContent, ctx);
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: !result.error,
      reply: result.reply || '',
      captured: result.captured || {},
      tool_calls: result.tool_calls || [],
      status: result.status || 0,
      error: result.error || null,
    }),
  };
};
