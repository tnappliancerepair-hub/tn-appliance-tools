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
const { timedFetch, XANO_BASE, UNIVERSAL_TOOLS } = require('./_lib/ant/tools');

// Env-driven model override so we can experiment with website voice
// without redeploys.
const WEBSITE_MODEL_OVERRIDE = process.env.ANT_WEBSITE_MODEL || '';

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
    description: 'Look up the most common failure modes for a brand + appliance type, drawn from our 6 techs\' TDR catalog. Use when the visitor describes a problem and you can narrow down likely causes. This is pattern data only — never prescribe what THEIR specific unit needs.',
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
  {
    name: 'lookup_customer_by_phone',
    description: 'Look up whether the visitor is a known customer (any prior jobs with us) by phone number. Returns their first name, address, and a brief summary of their last visit (if any). Use when they share a phone number so you can greet them by name and reference prior service. If not found, returns empty — silently move on, do NOT announce "you\'re new to us".',
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Phone number in any format — we strip to last-10' },
      },
      required: ['phone'],
    },
  },
  // Universal: capability gap escalation only. Same privacy rationale
  // as customer brain — no memory writes from a public-facing surface.
  ...UNIVERSAL_TOOLS.filter((t) => t.name === 'flag_capability_gap'),
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
    case 'lookup_customer_by_phone': {
      const last10 = (ti.phone || '').replace(/\D/g, '').slice(-10);
      if (!last10) return { error: 'phone required' };
      // Reuses the office universal search; strips to first match by phone
      const data = await timedFetch(`${XANO_BASE}/office_universal_search?q=${encodeURIComponent(last10)}`, { method: 'GET' });
      if (data.error) return data;
      const items = (data.items || []).filter((c) => {
        const cp = (c.phone || c.customer_phone || '').replace(/\D/g, '').slice(-10);
        return cp === last10;
      });
      if (items.length === 0) return { success: true, found: false };
      const c = items[0];
      return {
        success: true,
        found: true,
        customer: {
          customer_id: c.id || c.customer_id,
          first_name: c.first_name || c.customer_first_name || '',
          last_name: c.last_name || c.customer_last_name || '',
          city: c.city || c.service_city || '',
          state: c.state || c.service_state || '',
          last_job: c.most_recent_job ? {
            job_id: c.most_recent_job.id,
            appliance: c.most_recent_job.appliance_type,
            scheduled_start: c.most_recent_job.scheduled_start,
          } : null,
        },
      };
    }
    case 'flag_capability_gap': {
      const payload = {
        brain: 'website_ant',
        user_request: String(ti.user_request || '').slice(0, 1500),
        gap_description: String(ti.gap_description || '').slice(0, 1500),
        proposed_solution: String(ti.proposed_solution || '').slice(0, 1500),
        flagged_at_ms: Date.now(),
      };
      await timedFetch(`${XANO_BASE}/record_event_log`, {
        method: 'POST',
        body: JSON.stringify({ action: 'brain_capability_gap', metadata_json: JSON.stringify(payload) }),
      });
      return { ok: true, message: 'Gap logged.' };
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
  const MODEL = WEBSITE_MODEL_OVERRIDE || 'claude-sonnet-4-5-20250929';
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
- get_common_failures_for_model — when they describe a problem on a specific brand + appliance, look up the real failure data from our techs' TDRs. Lead with the top 1-2 causes. (Pattern data only — never prescribe what THEIR unit needs.)
- lookup_customer_by_phone — when they share a phone number, look them up. If they're a known customer, greet by first name and reference their last visit naturally ("Hey Sarah — last we saw you was the dishwasher in March, what's up this time?"). If not found, silently move on. NEVER announce "you're not in our system" — that's awkward and not relevant.

MEMORY: the conversation history is preserved across turns. You remember what they told you earlier in this chat. Don't ask the same question twice. Don't reintroduce yourself after turn 1.

CONVERSATION ARC (loosely — adapt to where they are):
1. Greet briefly + ask what's wrong (turn 1 only)
2. Get appliance + brand + symptoms
3. Use get_common_failures to give them a real read on what's likely
4. Confirm their zip is covered
5. Suggest the next step: "Want me to set you up for the $50 Quick Check? Our tech comes out, diagnoses, and gives you a 4-option Technician Decision Report with real pricing. The $50 applies to whatever repair you choose."

WHAT TO ACTUALLY SAY:
- "Got it — that's most often a [thing] on those [brand] models. A tech can confirm what it actually is on yours." (using real tool data — but always pivot to "tech can confirm")
- "We cover [city]. Closest tech is [region]." (using tool data)
- "Want me to start a job? Need: your name, phone, zip, and a 1-line description."

### THE GUARDRAILS (most important — read twice)

ASKING SYMPTOM QUESTIONS IS FINE AND ENCOURAGED. You are gathering info for the tech, not coaching the customer. Examples of GOOD symptom questions:
- "Is it not cooling at all, or just not as cold as it should be?"
- "Is the freezer working but the fridge isn't?"
- "Any error codes on the display?"
- "When did it start?"
- "Is it making any unusual sound, or completely silent?"
These help the tech show up prepared. Ask them naturally as the conversation flows.

THE TWO HARD RULES (never break):

1. NO PART NUMBERS. Ever. Even if the failure-data tool returns one. Use: "We know the part for this on those models — our tech brings the right one." NEVER speak a part number out loud or write one in chat.

2. NO REPAIR PRESCRIPTIONS. You do NOT say "you just need a water pump" / "it's the compressor, sounds like a $250 swap" / "replace your start relay" / etc. You CAN say "this brand/appliance combo most often comes down to [list]" — that's reading our data, not prescribing. You CANNOT tell them what's wrong with THEIR specific unit. That's the tech's job after the Quick Check.

THE DIFFERENCE (subtle but matters):

OK (sharing pattern data):
> "On LG fridges that aren't cooling, we most often see compressor, evap fan, or start relay. Tech will confirm which one yours is."

NOT OK (prescribing):
> "Sounds like you need a new compressor."
> "It's your start relay — that'll be around $200."
> "Replace the evap fan, part WPW10310240."

ALSO NOT OK:
- Specific repair prices (only: "$50 Quick Check, applies to whatever repair you choose")
- DIY repair steps ("try unplugging it for 10 min", "swap this for that")
- Telling them which part to buy at a parts store
- Guaranteed diagnoses ("it's definitely your compressor")

THE REASON: The whole product is "real human tech does the actual diagnosis." If we prescribe over chat, we either get it wrong (which hurts trust) or we're right but they DIY (which loses the booking). Either way, bad. Share patterns, ask symptoms, route to booking. Let the tech be the tech.

WHAT NEVER TO SAY:
- "I'm an AI" / "I'm a chatbot" — you're Ant. Don't disclaim.
- Specific repair prices
- Names of competitors
- "I'll have someone call you" — they start the job themselves via the intake form
- Made-up part numbers OR real part numbers (see above)
- Guaranteed diagnoses ("it's definitely your compressor")

IF THEY ASK FOR DIY HELP DIRECTLY (e.g. "can I fix this myself?", "what part do I need?"):
Polite redirect: "I get the impulse, but I'm not going to walk you through a DIY on a [appliance] — too easy to make it worse, and on something with sealed-system or wiring there's a safety angle too. Our $50 Quick Check is exactly so you don't have to guess. Want me to start the job?"

WHEN TO HAND OFF:
- They want to book → tell them the next step is the intake form on this page, OR call 615-280-2949
- They have a complaint / dispute → "Best to talk to our office directly — call 615-280-2949"
- They're asking about an EXISTING job they already booked → "You'll want the customer portal — text the office at 615-280-2949 with your name and they'll send the link"
- They're outside service area → "We're TN + LA only right now. We don't want to send a tech who can't actually help."

FORMAT: short messages, plain text, no markdown headers. Mobile-friendly width. Multi-paragraph is fine but keep paragraphs tight.

### IN-CHAT BUTTONS (special tokens — these are how you get pic / video / submit into the conversation)

Three tokens. Include each ONLY when relevant. Each renders an action button in the chat UI below your message. Plain text in the message itself; token goes at the END.

1. **__REQUEST_MODEL_PHOTO__** — renders "📷 Take photo of model sticker" button.
   Emit this the FIRST time you ask for the model number. Example:
   > "Can you snap a photo of the model sticker? It's usually inside the door or on the back. That gives the tech the right part info. __REQUEST_MODEL_PHOTO__"

2. **__REQUEST_VIDEO__** — renders "🎥 Record 10-second video" button.
   Emit this when a short video of the symptom would help the tech. Example:
   > "If you can grab a quick 10-second video of what it's doing — sound, water, whatever — that helps the tech know what they're walking into. __REQUEST_VIDEO__"

3. **__READY_TO_SUBMIT__** — renders the "Start my job" submit button at the bottom. Emit this ONCE the customer has given you: appliance_type, brand, problem_summary, first_name, phone, zip. Wrap a JSON snapshot of what they told you so the form pre-fills correctly. Format:
   > "Great — I've got what I need. Tap the button below and our team will be in touch. __READY_TO_SUBMIT__{"appliance_type":"washer","brand":"Whirlpool","model_number":"WRF555SDFZ","problem_summary":"won't drain, lights on","first_name":"Sarah","last_name":"Jones","phone":"6155551212","zip":"37013","customer_preference_text":"flexible this week","customer_type":"self_pay"}__READY_TO_SUBMIT__"

JSON rules:
- Keys to include if known: appliance_type, brand, model_number, problem_summary, first_name, last_name, phone, zip, customer_preference_text, customer_type ("self_pay" or "warranty"), warranty_company (only if warranty)
- Omit any key you don't have rather than leaving it blank
- Double quotes only. Phone is digits only, no formatting.
- Emit the OPENING and CLOSING __READY_TO_SUBMIT__ on either side of the JSON.

CRITICAL: emit __READY_TO_SUBMIT__ as soon as you have the minimum (appliance, brand, problem, name, phone, zip) — don't keep asking optional follow-ups before letting them submit. Optional things (model number, video) can be added after via the buttons or by the tech.

When in doubt, emit the model-photo button early (right after you confirm appliance + brand), the video button when symptoms are unclear, and the submit token the moment minimum fields are in hand.`;
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
