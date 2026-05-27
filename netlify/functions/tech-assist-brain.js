// Tech Ant Assist brain — Claude with tools for the in-the-field tech.
// Default role: silent scribe (extracts TDR fields from anything texted,
// answers questions only when the data warrants).
//
// Architecture (2026-05-27 refactor): per-brain shell that delegates the
// multi-turn Claude tool-calling loop to _lib/ant/brain-core. Tools come
// from _lib/ant/tools — this brain picks the READ_TOOLS subset that
// makes sense in a tech context (no calendar overview, no full pulse).
//
// Caller (tech_sms_assist_POST.xs) sends:
//   { tech_id, tech_first_name, job_id, customer_id, brand, appliance,
//     problem, existing_captured, message, media_urls? }
// Returns:
//   { ok, reply, captured, tool_calls, status }

const { runBrainTurn, tryParseJsonReply } = require('./_lib/ant/brain-core');
const { READ_TOOLS, pickTools } = require('./_lib/ant/tools');

// Tech-side tool subset — only the tools that make sense for a tech
// mid-job. Customer history + model failures = directly useful while
// diagnosing. No calendar/pulse/search_customers (office concerns).
const TECH_TOOLS = pickTools(READ_TOOLS, [
  'get_customer_service_history',
  'get_common_failures_for_model',
]);

function buildSystemPrompt(ctx) {
  return `You are Ant, the silent scribe + smart teammate for an appliance-repair tech mid-job. Hands dirty, on the road. NOT a chatbot — you only speak when you have real value to add.

OUTPUT FORMAT: respond with valid JSON only, no markdown fence:
{"reply":"<under-250-char plain text or empty string>","captured":{"diagnosis":string?,"failed_component":string?,"verified_part_number":string?,"replaced_by_part_number":string?,"labor_hours":string?,"repair_completed":string?,"parts_status":string?,"recommendation":string?}}

TOOLS AVAILABLE: get_customer_service_history, get_common_failures_for_model. USE THEM when the data would change your reply:
- Tech says "this is the third time I've been here" → call get_customer_service_history
- Tech is diagnosing a tricky issue → call get_common_failures_for_model
- Tech asks "what does this customer usually have?" → call get_customer_service_history
DON'T call tools just to look smart — only when the data matters.

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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
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

  // Build user content (text-only OR multi-part with image blocks for MMS).
  const mediaUrls = Array.isArray(body.media_urls)
    ? body.media_urls.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    : [];
  const textBody = (body.message || '').trim();
  let userContent;
  if (mediaUrls.length > 0) {
    userContent = mediaUrls.map((u) => ({ type: 'image', source: { type: 'url', url: u } }));
    if (textBody) {
      userContent.push({ type: 'text', text: textBody });
    } else {
      userContent.push({ type: 'text', text: '(Tech sent a photo with no caption — extract any visible model/serial/part/error code text and treat as TDR fields.)' });
    }
  } else {
    userContent = textBody;
  }

  const systemPrompt = buildSystemPrompt(ctx);
  const result = await runBrainTurn({
    systemPrompt,
    userContent,
    tools: TECH_TOOLS,
    ctx,
    maxIterations: 4,
    maxTokens: 1500,
    claudeTimeoutMs: 25_000,
  });

  // Tech-side scribe returns structured JSON {reply, captured}; parse it.
  const parsed = tryParseJsonReply(result.reply);

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: !result.error,
      reply: parsed.reply || '',
      captured: parsed.captured || {},
      tool_calls: result.tool_calls || [],
      status: result.status || 0,
      error: result.error || null,
    }),
  };
};
