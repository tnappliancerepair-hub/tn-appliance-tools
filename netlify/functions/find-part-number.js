// Multi-source part number finder. Phase 1: Claude reasoning as primary
// source. Phase 2 (when Marcone + Triple S APIs land): those become the
// anchors and Claude becomes the backstop / disambiguator.
//
// Architecture for the "unanimous answer" pattern Teddy laid out:
//   - Query N sources in parallel
//   - Extract candidate part numbers from each
//   - Score by source-agreement: 3+ agree = HIGH, 2 = MEDIUM, 1 = LOW
//
// Today: 1 source (Claude). All results are LOW confidence by default.
// As sources are added below, the agreement scoring kicks in naturally.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const TIMEOUT_MS = 30000;

const SYSTEM_PROMPT = `You are an appliance-parts expert helping a repair tech identify the
correct OEM part number for a failed component.

Given: {brand, appliance_type, model_number, failed_component, symptoms}
Return: ranked candidate part numbers with reasoning.

For each candidate, surface:
  - OEM part number (the canonical one — Whirlpool W-prefix, GE WR-prefix, etc.)
  - Common aftermarket / supersession equivalents (if any)
  - Why you believe this is the right part (1-2 sentences)
  - Confidence (0.0-1.0) based on certainty given the inputs
  - Likely price range (USD)
  - Where the tech can verify (Sears Parts Direct URL pattern, etc.)

CRITICAL HONESTY RULES:
  - If the model number is ambiguous (e.g. wildcard or partial), say so
  - If you're guessing, say so — never invent a confident part number
  - If multiple plausible parts exist, list ALL of them ranked by likelihood
  - Note when a part has been superseded (old → new) and pick the new one
  - Brand naming: Whirlpool / Maytag / KitchenAid / Amana / JennAir all
    share the Whirlpool catalog (W-prefix). GE / Hotpoint / Cafe / Profile
    all share the GE catalog (WR-prefix). Group by family in your response.

Return your output as a JSON object only — no preamble, no markdown:

{
  "primary_candidate": {
    "part_number": "W10876537",
    "name": "Drain Pump Motor",
    "confidence_0_1": 0.85,
    "reasoning": "...",
    "estimated_price_usd_low": 60,
    "estimated_price_usd_high": 110,
    "supersedes": ["WPW10876537"],
    "aftermarket_equivalents": ["SUP-W10876537"]
  },
  "alternates": [
    { ...same shape... }
  ],
  "verify_at": [
    "https://www.searspartsdirect.com/search?q=W10876537",
    "https://www.repairclinic.com/Shop-For-Parts?search=W10876537"
  ],
  "confidence_notes": "Why this confidence level — what's known vs guessed"
}`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return cors(200, '');
  }
  if (event.httpMethod !== 'POST') {
    return cors(405, JSON.stringify({ error: 'method_not_allowed' }));
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return cors(400, JSON.stringify({ error: 'invalid_json' })); }

  const brand = String(body.brand || '').trim();
  const appliance = String(body.appliance_type || '').trim();
  const model = String(body.model_number || '').trim();
  const component = String(body.failed_component || '').trim();
  const symptoms = String(body.symptoms || '').trim();

  if (!brand && !model && !component) {
    return cors(400, JSON.stringify({ error: 'need at least one of: brand, model_number, failed_component' }));
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return cors(500, JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }));

  const userMessage =
    `Brand: ${brand || '(unknown)'}\n` +
    `Appliance: ${appliance || '(unknown)'}\n` +
    `Model number: ${model || '(unknown)'}\n` +
    `Failed component: ${component || '(unknown)'}\n` +
    (symptoms ? `Symptoms: ${symptoms}\n` : '') +
    `\nReturn the JSON object only.`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return cors(502, JSON.stringify({ error: 'claude_fetch_failed: ' + String(err.message || err) }));
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    return cors(resp.status, JSON.stringify({ error: 'claude_non_2xx', detail: errText.slice(0, 300) }));
  }

  const data = await resp.json();
  const blocks = data.content || [];
  const rawText = blocks.find((b) => b.type === 'text')?.text || '';

  // Strip code fences if Claude wrapped its JSON
  const stripped = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
  let parsed = null;
  try { parsed = JSON.parse(stripped); }
  catch (_) { /* fall through */ }

  // Source-agreement scoring: today we have 1 source (Claude). All
  // candidates get a single 'sources_agreeing' = 1. When more sources
  // land (Marcone API, Triple S API, scrape sources), the parts that
  // appear in multiple source responses get sources_agreeing bumped.
  let candidates = [];
  if (parsed && parsed.primary_candidate) {
    candidates.push({ ...parsed.primary_candidate, sources: ['claude'], sources_agreeing: 1, confidence_tier: 'LOW' });
    for (const a of (parsed.alternates || [])) {
      candidates.push({ ...a, sources: ['claude'], sources_agreeing: 1, confidence_tier: 'LOW' });
    }
  }

  // Confidence tier:
  //   HIGH = sources_agreeing >= 3
  //   MEDIUM = sources_agreeing == 2
  //   LOW = sources_agreeing == 1 (Claude solo)
  // Plus: if Claude's confidence is < 0.5, downgrade to GUESS.
  candidates = candidates.map((c) => {
    let tier = 'LOW';
    if (c.sources_agreeing >= 3) tier = 'HIGH';
    else if (c.sources_agreeing === 2) tier = 'MEDIUM';
    if ((c.confidence_0_1 || 0) < 0.5 && tier === 'LOW') tier = 'GUESS';
    return { ...c, confidence_tier: tier };
  });

  return cors(200, JSON.stringify({
    success: true,
    input: { brand, appliance_type: appliance, model_number: model, failed_component: component, symptoms },
    candidates,
    verify_at: (parsed && parsed.verify_at) || [],
    confidence_notes: (parsed && parsed.confidence_notes) || '',
    sources_queried: ['claude'],
    note: 'Phase 1 — Claude solo. Marcone + Triple S API integration pending. Source-agreement scoring upgrades automatically when more sources land.',
    raw_preview: stripped.slice(0, 600),
  }, null, 2));
};

function cors(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body,
  };
}
