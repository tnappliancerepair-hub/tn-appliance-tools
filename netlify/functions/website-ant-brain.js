// Website Ant brain — Claude with prospect-facing tools.
//
// This is the chat that lives on the public marketing site (index.html,
// appliance-ant.html, etc). Visitor is a PROSPECT — not yet a customer.
// Goal of the conversation: help them figure out what's wrong, confirm
// we cover their area, gather symptoms, and route to booking.
//
// Tone: warm, brand-on, NOT salesy. The differentiator is that Ant
// answers real questions with real data (common failures from our TDR
// catalog, real service-zone coverage) instead of generic chatbot
// platitudes.
//
// Tool set is intentionally narrow + read-only for safety. No write tools
// on the public surface — booking happens through the existing intake
// flow once the visitor decides to start.

const { runBrainTurn } = require('./_lib/ant/brain-core');
const { timedFetch, XANO_BASE } = require('./_lib/ant/tools');

const WEBSITE_TOOLS = [
  {
    name: 'check_service_zone_coverage',
    description: 'Check whether a zip code is in TN Appliance Exchange\'s service area. Returns coverage status + market (Nashville TN, Baton Rouge LA, etc.). Call this whenever the visitor mentions a zip, city, or asks "do you cover my area?"',
    input_schema: {
      type: 'object',
      properties: {
        zip_code: { type: 'string', description: '5-digit zip code' },
      },
      required: ['zip_code'],
    },
  },
  {
    name: 'get_common_failures_for_model',
    description: 'Look up the most common failure modes for a brand + appliance type, drawn from our 6 techs\' TDR catalog. Use when the visitor describes a problem and you can narrow down likely causes ("LG fridge not cooling" → "most common: compressor, evap fan, start relay"). Be honest about the limits — this is pattern data, not a diagnosis.',
    input_schema: {
      type: 'object',
      properties: {
        brand: { type: 'string' },
        appliance_type: { type: 'string', description: 'refrigerator, dryer, range, dishwasher, washer, oven, microwave, hvac' },
        model_number: { type: 'string', description: 'Optional — narrows results' },
      },
      required: ['brand', 'appliance_type'],
    },
  },
];

async function executeWebsiteTool(toolName, ti) {
  switch (toolName) {
    case 'check_service_zone_coverage': {
      const zip = (ti.zip_code || '').replace(/\D/g, '').slice(-5);
      if (!zip) return { error: 'zip_code required' };
      return await timedFetch(`${XANO_BASE}/check_service_zone?zip_code=${zip}`, { method: 'GET' });
    }
    case 'get_common_failures_for_model': {
      const brand = encodeURIComponent(ti.brand || '');
      const appl = encodeURIComponent(ti.appliance_type || '');
      const model = encodeURIComponent(ti.model_number || '');
      return await timedFetch(`${XANO_BASE}/get_common_failures?brand=${brand}&appliance_type=${appl}&model_number=${model}&per_page=5`, { method: 'GET' });
    }
    default:
      return { error: `unknown website tool: ${toolName}` };
  }
}

// Same multi-turn pattern as brain-core but with the website tool
// executor inlined (mirrors customer-ant-brain.js for safety isolation —
// don't share the executeTool path with office-side tools).
async function runWebsiteBrainTurn({ systemPrompt, userContent, history, maxIterations = 4 }) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
  const MODEL = 'claude-sonnet-4-5-20250929';
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
          tools: WEBSITE_TOOLS,
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
      const result = await executeWebsiteTool(tu.name, tu.input || {});
      toolCallsLog.push({
        name: tu.name,
        input: tu.input,
        result_summary: result.error ? 'error:' + result.error : 'ok',
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result).slice(0, 12000),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return { reply: finalText, tool_calls: toolCallsLog, status: lastStatus };
}

function buildSystemPrompt() {
  return `You are Ant, the AI appliance-repair assistant for TN Appliance Exchange — a family-owned repair business serving Middle Tennessee and Louisiana. The person you're chatting with is a PROSPECT (not yet a customer) on our website. They're considering whether to use us.

YOUR ROLE: Help them figure out what's wrong with their appliance, confirm we cover their area, and gently lead them toward booking a Quick Check ($50, credited toward repair). NOT a hard sale. NOT a generic chatbot. Be the helpful expert who happens to also be the booking path.

PERSONALITY: warm, direct, knowledgeable. Like talking to a family-business owner who knows appliances cold. NO greetings beyond turn 1. NO "I'd be happy to help." NO emoji.

TOOLS YOU HAVE (use them aggressively):
- check_service_zone_coverage — confirm we cover their area. Use it the MOMENT they mention a zip, city, or "do you serve [place]". Don't make them ask.
- get_common_failures_for_model — when they describe a problem on a specific brand + appliance, look up the real failure data from our techs' TDRs. Lead with the top 1-2 causes.

CONVERSATION ARC (loosely — adapt to where they are):
1. Greet briefly + ask what's wrong (turn 1 only)
2. Get appliance + brand + symptoms
3. Use get_common_failures to give them a real read on what's likely
4. Confirm their zip is covered
5. Suggest the next step: "Want me to set you up for the $50 Quick Check? Our tech comes out, diagnoses, and gives you a 4-option Technician Decision Report with real pricing. The $50 applies to whatever repair you choose."

WHAT TO ACTUALLY SAY:
- "Got it — that's most often a [thing] on those [brand] models." (using real tool data)
- "We cover [city]. Closest tech is [region]." (using tool data)
- "Want me to start a job? Need: your name, phone, zip, and a 1-line description."

WHAT NEVER TO SAY:
- "I'm an AI" / "I'm a chatbot" — you're Ant. Don't disclaim.
- Specific repair prices (we don't know yet — that's what Quick Check is for)
- Names of competitors
- "I'll have someone call you" — they should start the job themselves via the intake form
- Made-up part numbers or guaranteed diagnoses

WHEN TO HAND OFF:
- They want to book → tell them the next step is the intake form on this page, OR call 615-280-2949
- They have a complaint / dispute → "Best to talk to our office directly — call 615-280-2949"
- They're asking about an EXISTING job they already booked → "You'll want the customer portal — text the office at 615-280-2949 with your name and they'll send the link"
- They're outside service area → "We're TN + LA only right now. We don't want to send a tech who can't actually help."

FORMAT: short messages, plain text, no markdown headers. Mobile-friendly width. Multi-paragraph is fine but keep paragraphs tight.`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'POST only' };
  }
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad json' }) };
  }
  const message = (body.message || '').trim();
  if (!message) return { statusCode: 400, body: JSON.stringify({ error: 'message required' }) };

  const history = Array.isArray(body.history) ? body.history : [];
  const result = await runWebsiteBrainTurn({
    systemPrompt: buildSystemPrompt(),
    userContent: message,
    history,
  });

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ok: !result.error,
      reply: result.reply || '',
      tool_calls: result.tool_calls || [],
      status: result.status || 0,
      error: result.error || null,
    }),
  };
};
