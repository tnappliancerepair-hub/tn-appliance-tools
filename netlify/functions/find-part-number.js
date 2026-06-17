// Part number finder — claude_only mode.
//
// HISTORY: the original tried to scrape 9 consumer/B2B parts sites and have
// Claude parse the combined HTML. Reality (documented 2026-06-02): ~9 of 10
// Cloudflare-block server-side fetches from Netlify IPs, so Claude got fed
// anti-bot/captcha HTML and the JSON parse died -> "claude_parse_failed".
//
// This version skips scraping entirely and asks Claude directly for the OEM
// part number(s) from its training knowledge — the honest, working default
// until the Marcone + Tribles APIs land (the live Marcone+Amazon daemon is the
// separate "Auto-find parts" path). Confidence is labeled honestly: HIGH for
// common consumables (water filters, belts), MEDIUM/LOW for parts that need the
// exact model variant. Never fabricates a confident number it isn't sure of.
//
// Response shape is unchanged so the Teddy-Tool modal renders it as-is.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const CLAUDE_TIMEOUT_MS = 22000;

const SYSTEM_PROMPT = `You are a master appliance-parts specialist. Given a brand, model number,
appliance type, and the failed component, identify the correct OEM part number(s).

Use your knowledge of appliance part catalogs and cross-references. Kenmore models
with a 3-digit prefix tell you the real manufacturer (e.g. 795 = LG, 106 = Whirlpool,
253 = Frigidaire/Electrolux) — resolve to the true OEM part and note common aftermarket
equivalents.

Return ONLY a JSON object — no preamble, no markdown fences:

{
  "candidates": [
    {
      "part_number": "ADQ36006101",
      "name": "Refrigerator water filter (LG LT700P)",
      "confidence": "HIGH",
      "price_usd_low": 25,
      "price_usd_high": 45,
      "note": "OEM. Common equivalents: Kenmore 9690 / 46-9690, LG LT700P."
    }
  ],
  "best_oem": "ADQ36006101",
  "reasoning": "Why this part fits this exact model + component."
}

Rules:
  - confidence: HIGH only when you are confident for this model+component
    (common consumables like water filters, belts, ice makers are usually HIGH).
    MEDIUM/LOW when the exact part depends on a model variant you can't fully
    pin down — say so in the note. NEVER invent a confident number you aren't sure of.
  - 1 to 4 candidates, best first. Include OEM and notable aftermarket equivalents.
  - price_usd_low/high: rough street price range; omit if unknown.`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, '');
  if (event.httpMethod !== 'POST') return cors(405, JSON.stringify({ error: 'method_not_allowed' }));

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
    `Model: ${model || '(unknown)'}\n` +
    `Appliance: ${appliance || '(unknown)'}\n` +
    `Failed component: ${component || '(unknown)'}\n` +
    (symptoms ? `Symptoms: ${symptoms}\n` : '') +
    `\nReturn the JSON object only.`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CLAUDE_TIMEOUT_MS);
  let claudeResp;
  try {
    claudeResp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return cors(502, JSON.stringify({ success: false, error: 'claude_fetch_failed: ' + String((err && err.message) || err) }));
  }
  clearTimeout(timer);

  if (!claudeResp.ok) {
    const errText = await claudeResp.text().catch(() => '');
    return cors(claudeResp.status, JSON.stringify({ success: false, error: 'claude_non_2xx', detail: errText.slice(0, 300) }));
  }

  const data = await claudeResp.json();
  const rawText = (data.content || []).find((b) => b.type === 'text')?.text || '';
  const parsed = extractJson(rawText);

  if (!parsed || !Array.isArray(parsed.candidates)) {
    return cors(200, JSON.stringify({
      success: false,
      error: 'claude_parse_failed',
      raw_preview: rawText.slice(0, 400),
    }));
  }

  // Map Claude's candidates into the tool's expected shape.
  const candidates = parsed.candidates.map((c) => {
    const tier = String(c.confidence || 'LOW').toUpperCase();
    return {
      part_number: normalizePartNumber(c.part_number || ''),
      name: c.name || '',
      confidence_tier: (tier === 'HIGH' || tier === 'MEDIUM') ? tier : 'LOW',
      estimated_price_usd_low: (c.price_usd_low != null) ? Number(c.price_usd_low) : null,
      estimated_price_usd_high: (c.price_usd_high != null) ? Number(c.price_usd_high) : null,
      note: c.note || '',
      sources: ['ant_knowledge'],
      sources_agreeing: 1,
    };
  }).filter((c) => c.part_number);

  return cors(200, JSON.stringify({
    success: true,
    mode: 'claude_only',
    input: { brand, appliance_type: appliance, model_number: model, failed_component: component, symptoms },
    candidates,
    best_guess_reasoning: parsed.reasoning || '',
    best_oem: parsed.best_oem ? normalizePartNumber(parsed.best_oem) : '',
    note: 'Direct OEM lookup from Ant\'s knowledge. Confirm against Marcone/Amazon (Auto-find parts) before ordering high-cost parts.',
  }, null, 2));
};

// Robust JSON extraction: strip markdown fences, then if a direct parse fails,
// grab the first {...last } span. Kills the old "claude_parse_failed" on stray prose.
function extractJson(raw) {
  const stripped = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(stripped); } catch (_) {}
  const a = stripped.indexOf('{'), b = stripped.lastIndexOf('}');
  if (a !== -1 && b > a) { try { return JSON.parse(stripped.slice(a, b + 1)); } catch (_) {} }
  return null;
}

function normalizePartNumber(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, '');
}

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
