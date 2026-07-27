// hook-doctor — punches a raw clip up to the 3-beat formula that stops the scroll:
// a 1-second HOOK (a promise), a human MIDDLE (point the camera at the person), and
// a satisfying PAYOFF. Phase 1 upgrade: SERIES-aware (Fix or Toss / What killed it /
// Model->part / Fault-code) and GROUNDED in real repair data (the moat) — so the
// stat hook + proof line use OUR actual numbers, never invented ones.
//   POST { secret, title, transcript?, appliance?, brand?, model?, symptom?,
//          series?, character?, is_long?, facts? }
//     -> { ok, on_screen_hook, hooks:[5], hook_formats:[{format,text}], proof_line,
//          middle, payoff, notes, series, facts, title_suggestions:[], hashtags:[], cta }
'use strict';
const { getSecret } = require('./_lib/secrets');
const { runBrainTurn } = require('./_lib/ant/brain-core');
const cs = require('./_lib/content-series');
const brands = require('./_lib/brands');

function parseJson(raw) {
  const cleaned = String(raw || '').replace(/```json/g, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(cleaned.slice(s, e + 1)); } catch (_) {} }
  return null;
}
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

const SYS = `You are the "Hook Doctor" for TN Appliance Exchange LLC — a REAL family-owned appliance shop (since 2012, Middle Tennessee & South Louisiana). You punch raw clips up so people STOP SCROLLING and can't explain why they're watching an appliance video.

THE ONE TRUTH: nobody watches the appliance — they watch the PERSON. The repair is just the room the personality lives in. The hook sells the human moment or the tiny mystery, never the task.

THE 3-BEAT FORMULA:
1. HOOK (second 1 = a promise): make a thumb stop — a curiosity gap, a stakes line, or a price shock. Short, spoken out loud, real. NEVER a lie or fake promise.
2. MIDDLE: a one-line reminder of the HUMAN beat to point the camera at (the customer's reaction, the character in the shop, the confident hands). The fix happens in the background of a human moment.
3. PAYOFF (last second): the satisfying reveal (machine roars back / clean before-after) or the one-liner, plus a signature sign-off so people know it's US.

VOICE: genuine, folksy, dry, self-deprecating hillbilly, proud of the "good ol days." Never corporate, never hype-yelling ("SMASH LIKE"), never clickbait. Confident, warm, funny, real.

GROUNDING — THE MOAT: when REAL SHOP DATA is provided (how many of these we've repaired, the part we see fail most, fix-vs-replace cost), weave it in — it's the uncopyable trust signal. But you may ONLY use the exact numbers given. If no data is provided, do NOT invent counts, part numbers, or prices — write the hooks on the human/curiosity angle instead.

Return STRICT JSON only, no prose, this exact shape:
{
  "on_screen_hook": "<the single BEST first-second line to burn on screen, <=9 words, spoken-out-loud>",
  "hook_formats": [
    {"format":"curiosity","text":"<hook>"},
    {"format":"price_shock","text":"<hook — only if cost data given, else another curiosity/mistake>"},
    {"format":"mistake_callout","text":"<hook>"},
    {"format":"stat","text":"<hook grounded in the real count/part — ONLY if data given, else a stakes hook>"},
    {"format":"verdict","text":"<hook>"}
  ],
  "proof_line": "<1 sentence trust line grounded in the real data, or '' if no data>",
  "middle": "<1 sentence: the human moment to point the camera at>",
  "payoff": "<1 sentence: the closing beat / reveal / sign-off>",
  "title_suggestions": ["<2 platform titles following the series pattern, real + searchable>"],
  "notes": ["<2-3 production nudges: what to mic, when to hold a beat of silence, what to show>"]
}`;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });
  const title = String(b.title || '').trim();
  if (!title) return json(400, { error: 'title required' });

  // The STUDIO brand (channel): tn_appliance (default) or dish_guy, etc. Each brand
  // has its own voice + series + whether its hooks are data-grounded. NB: b.brand is
  // the APPLIANCE brand (e.g. Whirlpool) — the studio brand rides on b.channel.
  const brandCfg = brands.get(b.channel);
  const grounded = brandCfg.grounded !== false;
  const brandSys = brandCfg.personaSystem || SYS;   // per-brand voice, else the appliance Hook Doctor

  // Series: brand-specific (Dish Guy segments) or the appliance franchises.
  const series = brandCfg.series ? brands.seriesFor(brandCfg.key, b.series || b.content_type) : cs.seriesFor(b.series || b.content_type);

  // Grounding is appliance-only (the moat). Character brands (Dish Guy) skip it.
  const appliance = grounded ? (b.appliance || cs.inferAppliance([title, b.symptom, b.transcript].filter(Boolean).join(' '))) : '';
  let facts = null;
  if (grounded) {
    facts = b.facts || null;
    if (!facts) { try { facts = await cs.groundedFacts({ title, appliance, brand: b.brand, model: b.model, symptom: b.symptom }); } catch (_) { facts = { has_stat: false }; } }
  }

  const factLines = [];
  if (facts && facts.has_stat) {
    if (facts.based_on_n) factLines.push('We have repaired ' + facts.based_on_n + ' of these ' + (appliance || 'machines').toLowerCase() + ' in our own shop records.');
    if (facts.top_component) factLines.push('The failure we see most on these: ' + facts.top_component + (facts.seen_n ? ' (' + facts.seen_n + ' times)' : '') + '.');
    if (facts.repair_all_in && facts.new_unit_range) factLines.push('Typical fix ~$' + facts.repair_all_in + ' vs ~$' + facts.new_unit_range[0] + '-$' + facts.new_unit_range[1] + ' to replace.');
  }

  const user = [
    'SERIES: ' + series.label + ' — hook flavor: ' + series.hook_flavor,
    'Title pattern for this series: ' + series.title_pattern,
    'Clip topic / title: ' + title,
    (grounded && appliance) ? 'Appliance: ' + appliance : '',
    (grounded && b.brand) ? 'Brand: ' + b.brand : '',
    b.symptom ? 'Topic/problem: ' + b.symptom : '',
    b.character ? 'Character/person in the clip: ' + b.character : '',
    b.is_long ? 'Format: long-form video' : 'Format: short vertical clip (Reel/Short/TikTok)',
    grounded ? (factLines.length ? ('REAL SHOP DATA you MAY use (only these exact numbers):\n- ' + factLines.join('\n- ')) : 'REAL SHOP DATA: none provided — do NOT invent numbers; write on the human/curiosity angle.') : '',
    b.transcript ? ('Transcript/notes:\n' + String(b.transcript).slice(0, 4000)) : '',
    '\nWrite the hook package as strict JSON, in the series flavor + the brand voice.',
  ].filter(Boolean).join('\n');

  const r = await runBrainTurn({ systemPrompt: brandSys, userContent: user, ctx: { brain: 'hook_doctor', channel: brandCfg.key }, maxTokens: 1600 });
  if (r.error) return json(502, { error: 'brain_failed', detail: r.error });
  const parsed = parseJson(r.reply);
  if (!parsed || !(parsed.hook_formats || parsed.hooks)) return json(502, { error: 'parse_failed', raw: (r.reply || '').slice(0, 500) });

  const formats = Array.isArray(parsed.hook_formats) ? parsed.hook_formats.filter((x) => x && x.text) : [];
  const hooks = formats.length ? formats.map((x) => x.text) : (parsed.hooks || []);
  const proof = parsed.proof_line || cs.proofLineFrom(facts) || '';
  // Hashtags: series set, with {brand} filled if we know it.
  const hashtags = (series.hashtags || []).map((h) => h.replace('{brand}', String(b.brand || '').replace(/\s+/g, ''))).filter((h) => h !== '#');

  return json(200, {
    ok: true,
    on_screen_hook: parsed.on_screen_hook || hooks[0] || '',
    hooks,
    hook_formats: formats,
    proof_line: proof,
    middle: parsed.middle || '',
    payoff: parsed.payoff || '',
    title_suggestions: parsed.title_suggestions || [],
    notes: parsed.notes || [],
    series: series.key,
    channel: brandCfg.key,
    cta: series.cta,
    hashtags,
    facts: facts || null,
  });
};
