// differentiate-city — generate genuinely unique local content for a city lander
// so Google stops deduping the near-identical templates (Teddy 7/5). Seeded with
// REAL facts we pass in (county, region, nearby towns, local angle) so it writes
// varied prose AROUND true facts instead of inventing landmarks/stats.
//
//   POST { city, state, county, region, neighbors:[..], angle }
//     -> { ok, local_context, quick_answer, common_repairs_intro, philosophy, faq:[{q,a},{q,a}] }
'use strict';
const { getSecret } = require('./_lib/secrets');
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }

const SYS = `You write unique, accurate local content for an appliance-repair company's city pages (TN Appliance Exchange — an honest, transparent, AI-assisted repair shop; $50 Quick Check credited toward the repair; a Technician Decision Report with 4 options; they never share part numbers).

HARD RULES:
- Use ONLY the true facts provided (county, region, nearby towns) plus general, safe knowledge about the state's climate and housing (e.g. Louisiana = hot/humid, hurricane/flood exposure, hard on refrigerators/freezers/AC; Middle Tennessee = hard water in places, real seasonal swings). Do NOT invent specific landmarks, employers, business names, statistics, neighborhoods, or claims you aren't sure are true.
- Every city's text must read DIFFERENTLY — vary sentence structure, opening, and angle city to city. Do not follow a fill-in-the-blank template.
- Honest, grounded, no hype or fake urgency. Match a plain, confident, technician voice.
- Plain text only (no HTML/markdown). Separate paragraphs with a blank line.

Return ONLY a JSON object with these keys:
{"local_context": "2 short paragraphs of genuinely local appliance-repair context", "quick_answer": "1 short paragraph: how a broken appliance here gets handled (chat with Ant, video + model photo, real tech builds the TDR, diagnostic credits toward repair)", "common_repairs_intro": "1-2 sentences introducing common local failures, tied to the local climate/housing angle", "philosophy": "1-2 short paragraphs on repair-vs-replace framed for this area", "faq": [{"q":"a natural local question","a":"grounded answer"},{"q":"another","a":"answer"}]}`;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(200, { ok: true });
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'POST only' });
  const key = await getSecret('ANTHROPIC_API_KEY');
  if (!key) return j(200, { ok: false, error: 'ANTHROPIC_API_KEY not configured' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const city = String(b.city || '').trim();
  if (!city) return j(400, { ok: false, error: 'city required' });
  const facts = `City: ${city}, ${b.state || ''}\nCounty/Parish: ${b.county || '(unknown — keep general)'}\nRegion: ${b.region || ''}\nNearby towns we also serve: ${(b.neighbors || []).join(', ')}\nLocal angle to weave in (true): ${b.angle || '(none — use state climate/housing generally)'}`;

  let resp, d;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 1500, system: SYS,
        messages: [{ role: 'user', content: `Write the unique content for this city. Facts:\n${facts}\n\nReturn ONLY the JSON.` }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    d = await resp.json();
  } catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }
  let text = (d && d.content && d.content[0] && d.content[0].text) || '';
  text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  let out; try { out = JSON.parse(text); } catch (_) { return j(200, { ok: false, error: 'parse failed', raw: text.slice(0, 300) }); }
  return j(200, { ok: true, city, local_context: out.local_context || '', quick_answer: out.quick_answer || '', common_repairs_intro: out.common_repairs_intro || '', philosophy: out.philosophy || '', faq: Array.isArray(out.faq) ? out.faq.slice(0, 2) : [] });
};
