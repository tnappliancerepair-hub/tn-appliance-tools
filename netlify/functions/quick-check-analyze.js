// Warranty Quick Check™ — consumer-facing diagnosis-and-recommend
// endpoint. Customer fills the public /quick-check.html form with
// appliance details + a photo, hits Submit. This function takes the
// text input + base64 photo, asks Claude to analyze + return a
// structured answer (likely diagnosis, cost range, DIY feasibility,
// final recommendation, suggested parts).
//
// This is the realization of Teddy's original 2026 vision: can a
// customer self-serve a "should I fix this?" answer without a tech
// rolling? The accuracy improves over time as the parts catalog +
// historical TDR corpus grow.
//
// Request: POST { customer_name, email, phone, appliance_type,
//                 brand, model, problem_summary, photo_b64?, zip? }
// Response: { likely_diagnosis, top_failed_components[],
//             likely_part_numbers[], estimated_cost_low_cents,
//             estimated_cost_high_cents, diy_feasibility,
//             final_recommendation, recommendation_explanation,
//             confidence }

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const ANTHROPIC_MODEL = 'claude-sonnet-4-6-20250619'; // Sonnet for nuanced reasoning

const PROMPT_TEMPLATE = (input) => `You are an expert appliance repair technician advising a CASH-PAYING homeowner (no home warranty company in the picture — they're paying out of pocket). They paid $50 for this Quick Check because they want a fast, honest answer to ONE question: should they fix this appliance or replace it?

The value they paid for is SPEED + HONESTY. Don't push repair when replacement is smarter. Don't push a tech visit when DIY is reasonable. Treat them like a friend who happens to need real expertise.

CUSTOMER INPUT:
Appliance: ${input.brand || '(brand unknown)'} ${input.appliance_type || 'appliance'}
Model: ${input.model || '(not provided)'}
Problem the customer describes: "${input.problem_summary || '(no description)'}"
Customer ZIP (for cost regionalization): ${input.zip || '(not provided)'}

${input.photo_b64 ? 'A photo of the appliance is attached above.' : 'No photo provided.'}

YOUR JOB: Give a structured fix-or-replace answer + if fixable, a clear menu of 4 specific paths forward.

Return STRICT JSON with these fields:
{
  "fix_or_replace": "fix" | "replace" | "depends",
  "verdict_headline": "5-8 word punchy headline. E.g. 'Replace it — repair isn't worth it' OR 'Fix it — easy and cheap'",
  "verdict_explanation": "2-4 sentence honest explanation. Mention specific factors: appliance age estimate, repair cost vs replacement cost, complexity, common failure mode. Customer-facing tone, no jargon.",
  "likely_diagnosis": "Plain-English best guess of what's wrong, 1-2 sentences",
  "top_failed_components": ["1-3 most likely failed components, brief phrases"],
  "estimated_cash_repair_cost_low_cents": 12000,
  "estimated_cash_repair_cost_high_cents": 28000,
  "estimated_replacement_cost_low_cents": 65000,
  "estimated_replacement_cost_high_cents": 140000,
  "diy_feasibility": "easy" | "moderate" | "difficult" | "do_not_recommend",
  "confidence": "high" | "medium" | "low",
  "options": [
    {
      "id": "diy_oem",
      "title": "DIY with OEM part",
      "subtitle": "Original manufacturer quality",
      "total_cost_cents": 14000,
      "part_cost_cents": 14000,
      "labor_cost_cents": 0,
      "time_estimate": "1-2 hours",
      "best_for": "Customers comfortable with basic tools who want guaranteed-correct fit"
    },
    {
      "id": "diy_amazon",
      "title": "DIY with Amazon equivalent",
      "subtitle": "Compatible aftermarket part",
      "total_cost_cents": 7000,
      "part_cost_cents": 7000,
      "labor_cost_cents": 0,
      "time_estimate": "1-2 hours",
      "best_for": "Cost-conscious DIYers willing to accept slightly shorter expected lifespan"
    },
    {
      "id": "tech_install_oem",
      "title": "We install OEM part",
      "subtitle": "Tech comes out, 30-day labor warranty, $50 Quick Check applies to labor",
      "total_cost_cents": 27000,
      "part_cost_cents": 14000,
      "labor_cost_cents": 18000,
      "quick_check_credit_cents": 5000,
      "time_estimate": "Same-day or next-day visit",
      "best_for": "Customers who want it done right with a warranty on the labor — your $50 Quick Check applies as credit"
    }
  ],
  "questions_to_clarify": ["Up to 2 follow-up questions a tech would ask"]
}

COST RULES (cash customer, US national average, in cents):
- Simple parts (belt, thermistor, igniter): OEM $80-$220, Amazon $30-$90
- Mid-complexity (control board, valve, pump): OEM $180-$420, Amazon $60-$200
- Major (compressor, motor, transmission): OEM $380-$850, Amazon $180-$450
- Sealed-system refrigerator repair: typically NOT economical to DIY
- We-install labor flat fee: $180-$250 most repairs, $300+ for major
- $50 Quick Check applies as credit when customer chooses we-install

REPLACEMENT COST RULES:
- Basic appliance (washer, dryer, dishwasher, range): $450-$900 new
- Mid-tier (mid-tier French door fridge, premium dryer): $900-$1800
- Premium (smart appliances, counter-depth, double oven): $1800-$3500

FIX vs REPLACE DECISION (be honest):
- "replace" when: repair cost > 50% of replacement cost, OR appliance is 12+ years old AND repair > $400, OR sealed-system work on cheap fridge
- "fix" when: repair cost < 30% of replacement cost AND part is available
- "depends" when: repair cost 30-50% of replacement AND age 8-12 years (let customer decide based on attachment to the unit)

DIY feasibility:
- easy: belt swap, thermistor, filter, igniter — basic tools, ~1 hr
- moderate: control board, drain pump, dryer element — 2-4 hr
- difficult: refrigerator compressor, dishwasher pump, dryer drum bearings — specialty tools
- do_not_recommend: sealed system, gas line, structural — safety/licensure risk

OPTIONS LOGIC — only include options that make sense:
- If "replace" verdict: return empty options array. Customer's $50 is closing revenue — no further upsell needed.
- If DIY feasibility is "easy" or "moderate": include all 3 options (diy_oem, diy_amazon, tech_install_oem)
- If DIY feasibility is "difficult": skip diy_oem and diy_amazon, include only tech_install_oem
- If DIY feasibility is "do_not_recommend": include only tech_install_oem

WHEN you include tech_install_oem, calculate total_cost_cents as (part_cost + labor_cost - 5000). The $50 ($5000 cents) Quick Check fee applies as credit. The subtitle and best_for fields should mention this so the customer sees the value.

Be CONSERVATIVE on confidence. Better to say "medium" or "low" with good clarifying questions than guess "high" and be wrong.

The customer paid $50 for an honest expert opinion. Earn it.

IMPORTANT BUSINESS FRAMING for the verdict_explanation:
- If verdict is "replace", you can mention something like "Your $50 covered this Quick Check — that's the deal. We'd rather tell you the truth than upsell you on a repair that isn't worth it."
- If verdict is "fix" and they choose we-install, mention "Your $50 Quick Check applies as a credit to the labor cost."
- If verdict is "fix" and they DIY, the $50 was their cost for the honest answer + verified part recommendation — no further charge.`;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return cors({ statusCode: 200, body: '' });
  if (event.httpMethod !== 'POST') return cors({ statusCode: 405, body: 'Method Not Allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return cors({ statusCode: 400, body: JSON.stringify({ error: 'bad json' }) }); }

  const input = {
    customer_name: String(body.customer_name || '').slice(0, 200),
    email: String(body.email || '').slice(0, 200),
    phone: String(body.phone || '').slice(0, 50),
    appliance_type: String(body.appliance_type || '').slice(0, 80),
    brand: String(body.brand || '').slice(0, 80),
    model: String(body.model || '').slice(0, 80),
    problem_summary: String(body.problem_summary || '').slice(0, 2000),
    zip: String(body.zip || '').slice(0, 12),
    photo_b64: body.photo_b64 ? String(body.photo_b64).replace(/^data:image\/[a-z]+;base64,/, '') : '',
  };

  if (!input.problem_summary && !input.photo_b64) {
    return cors({ statusCode: 400, body: JSON.stringify({ error: 'need problem description OR photo' }) });
  }

  // Build the message content (image goes first if present)
  const userContent = [];
  if (input.photo_b64) {
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: input.photo_b64 },
    });
  }
  userContent.push({ type: 'text', text: PROMPT_TEMPLATE(input) });

  let result;
  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1200,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    const data = await apiRes.json();
    if (!apiRes.ok || !data.content) {
      throw new Error('claude api: ' + JSON.stringify(data).slice(0, 300));
    }
    const raw = String(data.content[0]?.text || '');
    const clean = raw.replace(/```json|```/g, '').trim();
    result = JSON.parse(clean);
  } catch (err) {
    return cors({ statusCode: 502, body: JSON.stringify({ error: 'analyzer failed: ' + err.message }) });
  }

  // Persist to Xano (event_log + a quick_check_submissions row if/when
  // we add that table — for now just event_log + an alert SMS to Teddy).
  try {
    await fetch(`${XANO_BASE}/save_quick_check_submission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: input.customer_name,
        email: input.email,
        phone: input.phone,
        appliance_type: input.appliance_type,
        brand: input.brand,
        model: input.model,
        problem_summary: input.problem_summary,
        zip: input.zip,
        had_photo: !!input.photo_b64,
        result_json: JSON.stringify(result),
      }),
    });
  } catch (_) {}

  return cors({
    statusCode: 200,
    body: JSON.stringify({ success: true, ...result }),
  });
};

function cors(resp) {
  return {
    ...resp,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      ...(resp.headers || {}),
    },
  };
}
