// content-ideas-background — the heavy half of the content-idea engine. A regular
// (sync) function times out on a multi-idea Claude generation, so this runs as a
// 15-min background function: pull the real repair corpus, aggregate, ask Claude
// for a grounded weekly content calendar, and write it to the vault. The fast
// reader (content-ideas.js) triggers this and polls the vault for the result.
'use strict';

const { getSecret, setSecret } = require('./_lib/secrets');
const { runBrainTurn, tryParseJsonReply } = require('./_lib/ant/brain-core');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const IDEAS_KEY = 'SOCIAL_CONTENT_IDEAS';

async function jfetch(url, opts) { try { const r = await fetch(url, opts); return await r.json(); } catch (_) { return null; } }
function topKey(obj) { let best = null, n = -1; for (const k in obj) if (obj[k] > n) { best = k; n = obj[k]; } return best; }

// Aggregate the failure corpus into signals (appliance + component + brand + count).
// Part numbers are the internal moat — never included in what generates captions.
function buildSignals(entries) {
  const groups = {}; const seen = new Set();
  for (const e of entries) {
    const appliance = (e.appliance_type || '').trim();
    const comp = (e.failed_component || '').trim();
    const brand = (e.brand || '').trim();
    const jid = e.job_id || '?';
    if (!appliance && !comp) continue;
    const pair = jid + '|' + (e.verified_part_number || '') + '|' + comp;
    if (seen.has(pair)) continue; seen.add(pair);
    const key = (appliance || '?').toLowerCase() + '::' + (comp || '?').toLowerCase();
    if (!groups[key]) groups[key] = { appliance, component: comp, brands: {}, n: 0 };
    groups[key].n += 1;
    if (brand) groups[key].brands[brand] = (groups[key].brands[brand] || 0) + 1;
  }
  return Object.values(groups)
    .sort((a, b) => b.n - a.n)
    .slice(0, 14)
    .map((g) => ({ appliance: g.appliance || 'appliance', component: g.component || 'unspecified', jobs: g.n, top_brand: topKey(g.brands) || null }));
}

const SYSTEM = `You are head of content for TN Appliance Exchange LLC — a family-owned appliance REPAIR company serving the Nashville TN and New Orleans LA areas, founded 2012. Brand voice: real working techs, radical transparency, honest "fix it or replace it" advice, warm and plain-spoken, never hype, never condescending. Our moat is that we are the honest real-tech shop — we tell people the truth even when it costs us the job.

You are given the shop's REAL recurring repairs, aggregated from completed work orders. Turn them into a week of short-form social content ideas (TikTok / Reels / Shorts, plus Facebook/Instagram feed).

Hard rules:
- Ground every idea in the real data. Reference true frequency naturally ("one of the most common dryer failures we see") — never invent statistics.
- NEVER put a part number in a caption. We do not hand part numbers to customers.
- Safety: any gas, 240V, sealed-system/refrigerant, or water-supply-line job -> set needs_pro true, and the caption must clearly say to call a pro, don't DIY that one.
- Mix formats. Lead with our signature "fix_or_not" format and talking-head tech explainers; use quick_tip and maintenance for evergreen.
- CTA in every caption: phone 615-280-2949, honest and low-pressure. Include 4-8 relevant hashtags.
- "grounded" is true when the idea comes straight from the supplied real failures; false when it's an evergreen brand/service topic rounding out the week.

Return STRICT JSON only, no prose:
{"ideas":[{"title":"","appliance":"","format":"fix_or_not|talking_head|quick_tip|maintenance|review_card|b_roll_voiceover","hook":"first 1-2s on-screen text","angle":"what the clip covers, 1-2 sentences","caption":"ready-to-post caption incl. 615-280-2949","hashtags":["..."],"needs_pro":false,"grounded":true}]}
Generate exactly 8 ideas.`;

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };

  const raw = await jfetch(`${XANO}/get_common_failures?per_page=1000`);
  const entries = (raw && raw.entries) || [];
  const signals = buildSignals(entries);

  const userContent = 'Real recurring repairs (aggregated from our completed work orders):\n'
    + JSON.stringify(signals)
    + `\n\nTotal failure records in the corpus: ${entries.length}. Generate this week's content calendar as STRICT JSON.`;

  const out = await runBrainTurn({ systemPrompt: SYSTEM, userContent, maxTokens: 3200, ctx: { brain: 'content' } });
  const parsed = out && out.reply ? tryParseJsonReply(out.reply) : null;
  const ideas = (parsed && Array.isArray(parsed.ideas)) ? parsed.ideas : [];

  const payload = ideas.length
    ? { ok: true, generated_at: Date.now(), generating_at: null, corpus_size: entries.length, signals, ideas }
    : { ok: false, generated_at: Date.now(), generating_at: null, corpus_size: entries.length, signals, ideas: [], error: (out && out.error) || 'unparseable' };
  try { await setSecret(IDEAS_KEY, JSON.stringify(payload)); } catch (_) {}
  return { statusCode: 200, body: ideas.length ? 'ok' : 'no_ideas' };
};
