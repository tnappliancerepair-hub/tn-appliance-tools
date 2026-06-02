// Multi-source part number finder. Phase 2: real parallel web scraping
// across 4 consumer parts sites + Claude reasoning as a 5th source.
// Anchor sources (Marcone API, Tribles Appliance Parts API) plug in as
// additional voters when those integrations land.
//
// "Unanimous answer" pattern Teddy laid out:
//   - Query N sources in parallel
//   - Extract part numbers from each
//   - Score by agreement: 3+ agree = HIGH, 2 = MEDIUM, 1 = LOW, GUESS = bad
//
// Latency budget: ~5-7s total
//   - Parallel fetch all sources: 3-5s (slowest-source bound)
//   - Single Claude call to parse all HTML: 2-3s
//   - Aggregation: negligible

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const FETCH_TIMEOUT_MS = 8000;
const CLAUDE_TIMEOUT_MS = 25000;
const MAX_HTML_PER_SOURCE = 60000; // cap raw HTML so Claude context stays sane

// Full browser-style headers. Some consumer sites (RepairClinic,
// PartSelect, Sears) have Cloudflare-style anti-bot middleware that
// rejects bare Node/curl-style requests. Realistic Chrome on macOS
// signals + a referer from google.com pass most basic challenges.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const BROWSER_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.google.com/',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'cross-site',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
  'Sec-Ch-Ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
};

const SOURCES = [
  {
    id: 'sears',
    name: 'Sears Parts Direct',
    buildUrl: (q) => `https://www.searspartsdirect.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'repairclinic',
    name: 'RepairClinic',
    buildUrl: (q) => `https://www.repairclinic.com/Shop-For-Parts?search=${encodeURIComponent(q)}`,
  },
  {
    id: 'partspros',
    name: 'AppliancePartsPros',
    buildUrl: (q) => `https://www.appliancepartspros.com/search.aspx?searchterm=${encodeURIComponent(q)}`,
  },
  {
    id: 'partselect',
    name: 'PartSelect',
    buildUrl: (q) => `https://www.partselect.com/search/?searchterm=${encodeURIComponent(q)}`,
  },
];

const HTML_PARSE_PROMPT = `You are parsing search-result HTML from appliance-parts retailers
to extract candidate part numbers. You will be given HTML from 4
different sites for the SAME query, plus context about what part
the user is looking for.

For each site, extract up to 3 candidate part numbers shown on the
results page. Focus on parts that match the failed_component the
user described.

Return a single JSON object — no preamble, no markdown:

{
  "by_source": {
    "sears":        [{"part_number": "...", "name": "...", "price_usd": 89.99}],
    "repairclinic": [...],
    "partspros":    [...],
    "partselect":   [...]
  },
  "fetch_errors": ["sears: 503", ...],
  "best_guess_oem": "W10876537",
  "best_guess_reasoning": "All 4 sites return the same OEM part for this model+component, matching Whirlpool's W-prefix convention."
}

Rules:
  - Only return part numbers that are clearly identified as the OEM
    part number on the page (or the SKU shown next to the part name)
  - If a source returned no relevant results, set its array to []
  - If a source's HTML is an anti-bot/captcha page, note in fetch_errors
  - best_guess_oem should be the part number that appears across the
    MOST sources (with the same number). If multiple parts tie, pick
    the one with the most matches and note alternatives in reasoning.
  - Normalize part numbers: uppercase, strip leading zeros, no dashes
    unless they're part of the canonical number
  - Brand-family note: Whirlpool/Maytag/KitchenAid/Amana/JennAir share
    W-prefix; GE/Hotpoint/Cafe share WR-prefix; group equivalents.`;

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

  // ── Step 1: build a search query that works across all 4 sites ───
  // Model + component is the most universally-effective shape.
  // Brand-only or component-only is too broad. Model alone misses the
  // specific part.
  const queryParts = [brand, model, component].filter(Boolean);
  const query = queryParts.join(' ');

  // ── Step 2: parallel HTML fetch ──────────────────────────────────
  const fetched = await Promise.all(
    SOURCES.map(async (s) => {
      const url = s.buildUrl(query);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          headers: BROWSER_HEADERS,
          signal: ac.signal,
          redirect: 'follow',
        });
        clearTimeout(timer);
        const text = await res.text();
        return {
          source_id: s.id,
          source_name: s.name,
          url,
          status: res.status,
          html: text.slice(0, MAX_HTML_PER_SOURCE),
          error: res.ok ? null : `HTTP ${res.status}`,
        };
      } catch (err) {
        clearTimeout(timer);
        return {
          source_id: s.id,
          source_name: s.name,
          url,
          status: 0,
          html: '',
          error: (err && err.name === 'AbortError') ? 'timeout' : (err.message || 'fetch_failed'),
        };
      }
    })
  );

  // ── Step 3: Claude parses all HTML in one call ──────────────────
  // Build a multi-source context block. We give Claude one chunk per
  // source. For failed fetches, we include the error so Claude can
  // report fetch_errors rather than hallucinating.
  const contextLines = [];
  contextLines.push(`Query: ${query}`);
  contextLines.push(`Brand: ${brand || '(unknown)'}`);
  contextLines.push(`Model: ${model || '(unknown)'}`);
  contextLines.push(`Appliance: ${appliance || '(unknown)'}`);
  contextLines.push(`Failed component: ${component || '(unknown)'}`);
  if (symptoms) contextLines.push(`Symptoms: ${symptoms}`);

  let htmlSection = '';
  for (const f of fetched) {
    htmlSection += `\n\n--- SOURCE: ${f.source_id} (${f.source_name}) ---\n`;
    htmlSection += `URL: ${f.url}\n`;
    if (f.error) {
      htmlSection += `FETCH ERROR: ${f.error}\n`;
    } else {
      htmlSection += `STATUS: ${f.status}\n`;
      htmlSection += `HTML (truncated to ${MAX_HTML_PER_SOURCE} chars):\n${f.html}\n`;
    }
  }

  const userMessage = contextLines.join('\n') + htmlSection + '\n\nReturn the JSON object only.';

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CLAUDE_TIMEOUT_MS);
  let claudeResp;
  try {
    claudeResp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: HTML_PARSE_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return cors(502, JSON.stringify({ error: 'claude_fetch_failed: ' + String(err.message || err) }));
  }
  clearTimeout(timer);

  if (!claudeResp.ok) {
    const errText = await claudeResp.text().catch(() => '');
    return cors(claudeResp.status, JSON.stringify({ error: 'claude_non_2xx', detail: errText.slice(0, 300) }));
  }

  const data = await claudeResp.json();
  const blocks = data.content || [];
  const rawText = blocks.find((b) => b.type === 'text')?.text || '';
  const stripped = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

  let parsed = null;
  try { parsed = JSON.parse(stripped); }
  catch (_) { /* fall through */ }

  if (!parsed) {
    return cors(200, JSON.stringify({
      success: false,
      error: 'claude_parse_failed',
      raw_preview: stripped.slice(0, 400),
      fetch_summary: fetched.map((f) => ({ source: f.source_id, status: f.status, error: f.error, html_chars: f.html.length })),
    }));
  }

  // ── Step 4: agreement scoring ────────────────────────────────────
  // Roll up by part number across all sources.
  const partAgreement = new Map(); // part_number → { sources: Set, names: [], prices: [] }
  const bySource = parsed.by_source || {};
  for (const [sourceId, candidates] of Object.entries(bySource)) {
    for (const c of (candidates || [])) {
      const pn = normalizePartNumber(c.part_number || '');
      if (!pn) continue;
      if (!partAgreement.has(pn)) partAgreement.set(pn, { sources: new Set(), names: [], prices: [] });
      const entry = partAgreement.get(pn);
      entry.sources.add(sourceId);
      if (c.name) entry.names.push(c.name);
      if (c.price_usd != null) entry.prices.push(Number(c.price_usd));
    }
  }

  const aggregated = Array.from(partAgreement.entries()).map(([pn, m]) => {
    const sourcesAgreeing = m.sources.size;
    let tier = 'LOW';
    if (sourcesAgreeing >= 3) tier = 'HIGH';
    else if (sourcesAgreeing === 2) tier = 'MEDIUM';
    const priceLow = m.prices.length ? Math.min(...m.prices) : null;
    const priceHigh = m.prices.length ? Math.max(...m.prices) : null;
    // Best name = the most common one (just pick the first for now)
    const name = m.names[0] || '';
    return {
      part_number: pn,
      name,
      sources: Array.from(m.sources),
      sources_agreeing: sourcesAgreeing,
      confidence_tier: tier,
      estimated_price_usd_low: priceLow,
      estimated_price_usd_high: priceHigh,
    };
  }).sort((a, b) => b.sources_agreeing - a.sources_agreeing);

  // If Claude provided a "best_guess_oem" and it's not in the aggregated
  // list (because no source listed it explicitly), add it as a LOW tier
  // entry — Claude's reasoning is still a useful signal.
  const guess = parsed.best_guess_oem ? normalizePartNumber(parsed.best_guess_oem) : '';
  if (guess && !aggregated.find((a) => a.part_number === guess)) {
    aggregated.push({
      part_number: guess,
      name: '',
      sources: ['claude_reasoning'],
      sources_agreeing: 1,
      confidence_tier: 'LOW',
      reasoning: parsed.best_guess_reasoning || '',
    });
  }

  const sourcesQueried = SOURCES.map((s) => s.id);
  const fetchErrors = fetched.filter((f) => f.error).map((f) => `${f.source_id}: ${f.error}`);

  return cors(200, JSON.stringify({
    success: true,
    input: { brand, appliance_type: appliance, model_number: model, failed_component: component, symptoms },
    query,
    candidates: aggregated,
    sources_queried: sourcesQueried,
    sources_succeeded: fetched.filter((f) => !f.error).map((f) => f.source_id),
    fetch_errors: fetchErrors,
    best_guess_reasoning: parsed.best_guess_reasoning || '',
    fetch_summary: fetched.map((f) => ({ source: f.source_id, status: f.status, error: f.error, html_chars: f.html.length })),
    note: 'Phase 2 — 4 web sources + Claude HTML parser. Marcone + Tribles Appliance Parts APIs slot in as anchor sources when available.',
  }, null, 2));
};

function normalizePartNumber(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, '').replace(/^0+/, '');
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
