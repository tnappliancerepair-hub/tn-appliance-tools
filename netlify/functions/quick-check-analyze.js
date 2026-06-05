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

const PROMPT_TEMPLATE = (input) => `You are an expert appliance repair technician advising a homeowner. They're trying to figure out if their broken appliance is worth fixing or replacing.

CUSTOMER INPUT:
Appliance: ${input.brand || '(brand unknown)'} ${input.appliance_type || 'appliance'}
Model: ${input.model || '(not provided)'}
Problem the customer describes: "${input.problem_summary || '(no description)'}"
Customer ZIP (for cost regionalization): ${input.zip || '(not provided)'}

${input.photo_b64 ? 'A photo of the appliance is attached above.' : 'No photo provided.'}

YOUR JOB: Give the customer an honest, structured answer.

Return STRICT JSON with these fields:
{
  "likely_diagnosis": "Plain-English best guess of what's wrong, 1-2 sentences. Use customer-safe language.",
  "top_failed_components": ["1-3 most likely components that have failed, brief phrases"],
  "likely_part_numbers": ["Up to 3 generic part-category names like 'drive belt', 'compressor start relay' — only include actual part numbers if you're confident from the model"],
  "estimated_cost_low_cents": 12000,
  "estimated_cost_high_cents": 28000,
  "diy_feasibility": "easy" | "moderate" | "difficult" | "do_not_recommend",
  "final_recommendation": "diy_reasonable" | "schedule_install_after_parts" | "schedule_in_home_visit" | "premium_video_diagnostic" | "replacement_more_economical",
  "recommendation_explanation": "2-3 sentence customer-facing explanation of WHY this recommendation. Warm tone. Mention specific factors (age of appliance, cost vs replacement value, complexity, safety).",
  "confidence": "high" | "medium" | "low",
  "questions_to_clarify": ["Up to 3 follow-up questions the tech would ask if they could, in customer-friendly language"]
}

Cost guidelines (US national average, in cents):
- Simple part swap (belt, thermistor, igniter): $80-$220
- Mid-complexity part (control board, valve, pump): $180-$420
- Major component (compressor, motor, transmission): $380-$850
- Sealed-system refrigerator repair: $500-$1200

DIY feasibility guidelines:
- easy: belt swap, thermistor, filter change — basic tools, 1-2 hours
- moderate: control board, drain pump, dryer heating element — intermediate, 2-4 hours, some disassembly
- difficult: refrigerator compressor, dishwasher pump, dryer drum bearings — technical, requires specific tools
- do_not_recommend: sealed-system work, gas line work, major structural — safety risk, requires licensure

Final recommendation guidelines:
- diy_reasonable: easy DIY + customer seems willing + part is cheap and available
- schedule_install_after_parts: known part, customer wants tech to install (most common warranty path)
- schedule_in_home_visit: diagnosis still uncertain, tech needs to see it
- premium_video_diagnostic: customer might DIY but wants live tech guidance ($89 service)
- replacement_more_economical: repair cost > 50% of new appliance value, OR appliance is 10+ years old AND repair > $400

Be CONSERVATIVE on confidence. If you don't have clear info, say so via "low" and emphasize the questions_to_clarify.

Be WARM but HONEST. If the customer should just buy a new appliance, say so kindly.

Be PRACTICAL about the disclaimer: TN Appliance Exchange only installs parts they supply themselves. Customer-purchased parts are not installed. Mention this only if recommendation involves a tech visit.`;

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
