// Parts Finder — the tech-facing "where's the part number" assistant.
// Internal/tech use ONLY (never expose part numbers to customers — standing
// rule). Given a model number + symptom, returns:
//   1. Deterministic deep-links into the major parts catalogs, pre-filled with
//      the model number (always works — this is the source of truth the tech
//      taps into to read the exploded diagram).
//   2. Best-effort AI candidate part numbers (Claude) when ANTHROPIC_API_KEY is
//      set — clearly labeled as suggestions to VERIFY on the diagram, never to
//      order blind (a wrong part number is wasted money + a repeat visit).
//
// POST { model, brand?, appliance_type?, symptom? }
// → { success, model, catalogs:[{label,url}], candidates:[{part_number,name,confidence,note}], ai_note }

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const msupply = require('./_lib/msupply');

// Enrich a list of {part_number,...} items with live Marcone cost + stock. Looks
// up each distinct part number against Marcone (account net price) in parallel and
// attaches a `marcone` field. Best-effort: failures just leave marcone null.
async function enrichMarcone(items) {
  const arr = Array.isArray(items) ? items : [];
  const nums = [...new Set(arr.map((i) => String(i.part_number || '').trim()).filter(Boolean))].slice(0, 8);
  if (!nums.length) return arr;
  const byNum = {};
  await Promise.all(nums.map(async (pn) => {
    try {
      const r = await msupply.lookupPart(pn, null, {});
      if (r && r.ok) byNum[pn.toLowerCase()] = { found: true, cost: r.cost, list: r.list, in_stock: r.in_stock, total_qty: r.total_qty, eta_days: r.eta_days, description: r.description, make: r.make };
      else byNum[pn.toLowerCase()] = { found: false };
    } catch (_) { byNum[pn.toLowerCase()] = { found: false }; }
  }));
  for (const it of arr) {
    const k = String(it.part_number || '').trim().toLowerCase();
    if (k && byNum[k]) it.marcone = byNum[k];
  }
  return arr;
}

// Tier 1 (highest trust): part numbers WE'VE actually used before on this
// appliance/brand/model, pulled from our own verified TDR corpus. "You used
// this exact part last time" beats any generic guess — this is the moat.
async function historyMatches({ model, brand, appliance_type }) {
  try {
    const qs = new URLSearchParams();
    if (appliance_type) qs.set('appliance_type', String(appliance_type).trim());
    if (brand) qs.set('brand', String(brand).trim());
    const r = await fetch(`${XANO}/get_common_failures?${qs.toString()}`, { method: 'GET' });
    if (!r.ok) return [];
    const d = await r.json().catch(() => ({}));
    const rows = (d && d.entries) || [];
    const modelLc = String(model || '').trim().toLowerCase();
    const brandLc = String(brand || '').trim().toLowerCase();
    const applLc = String(appliance_type || '').trim().toLowerCase();
    const scored = [];
    for (const e of rows) {
      const pn = String(e.verified_part_number || '').trim();
      if (!pn) continue;
      const em = String(e.model_number || '').trim().toLowerCase();
      const eb = String(e.brand || '').trim().toLowerCase();
      const ea = String(e.appliance_type || '').trim().toLowerCase();
      let match = '', rank = 0;
      if (modelLc && em && (em === modelLc || em.includes(modelLc) || modelLc.includes(em))) { match = 'this exact model'; rank = 3; }
      else if (brandLc && eb === brandLc && (!applLc || ea === applLc)) { match = 'this brand'; rank = 2; }
      else if (applLc && ea === applLc) { match = 'this appliance'; rank = 1; }
      else continue;
      scored.push({ part_number: pn, failed_component: String(e.failed_component || '').trim(), match, rank, used_ms: Number(e.created_at || 0) });
    }
    // best match first, newest within a tier; dedupe by part number
    scored.sort((a, b) => (b.rank - a.rank) || (b.used_ms - a.used_ms));
    const seen = new Set(), out = [];
    for (const s of scored) {
      if (seen.has(s.part_number)) continue;
      seen.add(s.part_number);
      out.push(s);
      if (out.length >= 5) break;
    }
    return out;
  } catch (_) { return []; }
}

function catalogLinks(model) {
  const m = encodeURIComponent(String(model || '').trim());
  if (!m) return [];
  // Best "see the exploded picture → tap the part → read the number" sources first.
  // (Marcone lives as the live-API price/stock box on the tech tool, not here —
  // its web portal is login-gated, so it's a poor quick-diagram link.)
  return [
    { label: 'PartSelect (exploded diagram — tap the part)', url: `https://www.partselect.com/search/?q=${m}` },
    { label: 'AppliancePartsPros (exploded diagram — tap the part)', url: `https://www.appliancepartspros.com/search.aspx?q=${m}` },
    { label: 'Sears PartsDirect (diagram + part #s)', url: `https://www.searspartsdirect.com/search?q=${m}` },
    { label: 'Encompass (OEM distributor — exploded diagram)', url: `https://encompass.com/search/?searchTerm=${m}` },
    { label: 'RepairClinic (diagram)', url: `https://www.repairclinic.com/Shop-For-Parts?query=${m}` },
  ];
}

async function aiCandidates({ model, brand, appliance_type, symptom }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { candidates: [], ai_note: 'AI suggestions off (no key). Use the catalog links to read the exploded diagram.' };

  const sys = 'You are an appliance-parts specialist helping a repair technician find the right OEM part number. '
    + 'Be conservative: only suggest part numbers you are reasonably confident map to the given brand+model. '
    + 'NEVER invent a plausible-looking number. If unsure, say so and rank confidence "low". '
    + 'The technician will VERIFY every number against the exploded diagram before ordering — make that clear. '
    + 'Respond with STRICT JSON only, no prose, shape: '
    + '{"candidates":[{"part_number":"","name":"","confidence":"high|medium|low","note":""}],"summary":""}';

  const user = `Brand: ${brand || '(unknown)'}\nModel: ${model}\nAppliance: ${appliance_type || '(unknown)'}\nSymptom / part needed: ${symptom || '(unspecified)'}\n\n`
    + 'Give the most likely OEM part number(s) for the failed component implied by the symptom. '
    + 'If the model is a premium/rebadged line (e.g. Samsung Bespoke vs Dacor), flag the size/variant gotcha in the note.';

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: sys,
        messages: [{ role: 'user', content: user }],
      }),
    });
    const d = await r.json();
    const text = (((d || {}).content || [])[0] || {}).text || '';
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 6) : [],
      ai_note: parsed.summary || 'Verify every suggested part number against the exploded diagram before ordering.',
    };
  } catch (err) {
    return { candidates: [], ai_note: 'AI lookup unavailable right now — use the catalog links. (' + (err.message || 'error') + ')' };
  }
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const body = JSON.parse(event.body || '{}');
    const model = String(body.model || '').trim();
    if (!model) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'model is required' }) };
    }
    const catalogs = catalogLinks(model);
    // Run our-history (tier 1) and AI candidates (tier 2) in parallel.
    const [from_history, ai] = await Promise.all([
      historyMatches({ model, brand: body.brand, appliance_type: body.appliance_type }),
      aiCandidates({ model, brand: body.brand, appliance_type: body.appliance_type, symptom: body.symptom }),
    ]);
    // Enrich both lists with live Marcone cost + stock (best-effort, parallel).
    await Promise.all([enrichMarcone(from_history), enrichMarcone(ai.candidates)]);
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        model,
        from_history,
        catalogs,
        candidates: ai.candidates,
        ai_note: ai.ai_note,
      }),
    };
  } catch (err) {
    console.error('parts-finder error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
