// ai-discovery-check — owner-gated "are we discoverable to the AIs" scoreboard.
//
// WHY: customers (even seniors) increasingly find repair shops by asking ChatGPT /
// Perplexity / Gemini / Google-AI "who fixes my dryer in Nashville" or "my Whirlpool
// dryer won't heat, what's wrong." Being crawlable is not the same as being
// recommended. There is no free API to poll the chat models directly, so this does the
// two things we CAN automate:
//   1) ASSET HEALTH — confirm the AI-facing foundation is intact (llms.txt depth,
//      robots.txt AI-bot blocks, homepage schema makesOffer/knowsAbout/sameAs, a /fix/
//      page's speakable schema). Catches silent regressions.
//   2) GSC RANK for the target AI-intent questions — the closest automatable proxy for
//      "are we surfacing," since the answer engines pull heavily from top organic
//      results. Reuses _lib/search-console.js (same as gsc-queries).
// The true "does ChatGPT recommend us" check stays a periodic human WebSearch spot-check
// (baseline captured 2026-09-01: TN ABSENT from "best appliance repair Nashville").
//
//   GET ?secret=<admin>[&days=28]
'use strict';
const { getSecret } = require('./_lib/secrets');
const gsc = require('./_lib/search-console');

const SITE = 'https://tnapplianceexchange.net';
exports.config = { timeout: 26 };
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(b, null, 2) }; }

// The questions an AI user actually types. We check where (if at all) GSC shows us
// ranking for the closest matching query — a proxy for "would the AI find/cite us."
const TARGET_QUESTIONS = [
  'appliance repair nashville',
  'dryer repair nashville',
  'refrigerator repair nashville',
  'washer repair nashville',
  'dishwasher repair nashville',
  'dryer not heating',
  'refrigerator not cooling',
  'washer wont drain',
  'whirlpool dryer not heating',
  'samsung refrigerator not cooling',
  'appliance repair near me',
];

async function getText(url, ms) {
  ms = ms || 6000;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'ai-discovery-check' } });
    return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : '' };
  } catch (e) { return { ok: false, status: 0, text: '', error: String(e.message || e) }; }
}

async function assetHealth() {
  const [llms, robots, home, fix] = await Promise.all([
    getText(`${SITE}/llms.txt`),
    getText(`${SITE}/robots.txt`),
    getText(`${SITE}/`),
    getText(`${SITE}/fix/dryer-not-heating.html`),
  ]);
  const checks = [
    { id: 'llms_served', ok: llms.ok, detail: `HTTP ${llms.status}` },
    { id: 'llms_depth_142', ok: /\b142\b/.test(llms.text), detail: 'llms.txt advertises the real 142-guide depth' },
    { id: 'llms_repair_not_used', ok: /do not sell used|we repair/i.test(llms.text), detail: 'explicit repair-not-used-store signal' },
    { id: 'robots_gptbot', ok: /User-agent:\s*GPTBot/i.test(robots.text), detail: 'GPTBot welcomed' },
    { id: 'robots_bingbot', ok: /User-agent:\s*Bingbot/i.test(robots.text), detail: 'Bingbot (Copilot) welcomed' },
    { id: 'robots_perplexity', ok: /User-agent:\s*PerplexityBot/i.test(robots.text), detail: 'PerplexityBot welcomed' },
    { id: 'home_makesOffer', ok: /"makesOffer"/.test(home.text), detail: 'homepage schema declares the nationwide $50 video-diagnostic Offer' },
    { id: 'home_knowsAbout', ok: /"knowsAbout"/.test(home.text), detail: 'homepage schema declares repair expertise topics' },
    { id: 'home_sameAs', ok: /"sameAs"/.test(home.text), detail: 'homepage schema links its entity profiles' },
    { id: 'fix_speakable', ok: /SpeakableSpecification|"speakable"/i.test(fix.text), detail: 'fix guide carries speakable (AI-Overview-liftable) schema' },
    { id: 'fix_faqpage', ok: /"FAQPage"/.test(fix.text), detail: 'fix guide carries FAQPage schema' },
  ];
  const passed = checks.filter((c) => c.ok).length;
  return { passed, total: checks.length, all_ok: passed === checks.length, checks };
}

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

async function gscRanks(days) {
  const res = await gsc.query({ days, dimensions: ['query'], rowLimit: 2000 }).catch(() => null);
  if (!res || !res.ok) return { configured: !!(res && res.configured !== false), error: res && (res.error || 'gsc unavailable'), rows: [] };
  const rows = (res.rows || []).map((r) => ({ q: norm(r.keys && r.keys[0]), position: Math.round((r.position || 0) * 10) / 10, impressions: r.impressions || 0, clicks: r.clicks || 0 }));
  const out = TARGET_QUESTIONS.map((tq) => {
    const key = norm(tq);
    // exact match first, else the best (lowest-position) query that contains all the words
    const words = key.split(' ');
    let best = rows.find((r) => r.q === key);
    if (!best) {
      const cand = rows.filter((r) => words.every((w) => r.q.includes(w)));
      cand.sort((a, b) => a.position - b.position);
      best = cand[0];
    }
    return best
      ? { question: tq, ranking: true, matched_query: best.q, position: best.position, impressions: best.impressions, clicks: best.clicks }
      : { question: tq, ranking: false, note: 'not in GSC top data — not surfacing for this question' };
  });
  const ranking = out.filter((o) => o.ranking).length;
  return { configured: true, days, ranking, total: out.length, questions: out };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const days = Math.max(1, Math.min(90, parseInt(q.days, 10) || 28));

  const [health, ranks] = await Promise.all([assetHealth(), gscRanks(days)]);

  return json(200, {
    ok: true,
    checked_at: new Date().toISOString(),
    summary: {
      asset_health: `${health.passed}/${health.total} foundation checks pass`,
      gsc_surfacing: ranks.configured ? `${ranks.ranking}/${ranks.total} target questions rank in Google (proxy for AI surfacing)` : 'GSC not configured',
    },
    // The human spot-check the models actually get asked (no free API to automate):
    human_spotcheck: {
      how: 'Search each in ChatGPT / Perplexity / Google AI and see if tnapplianceexchange.net is named/cited.',
      baseline_2026_09_01: 'ABSENT from "best appliance repair Nashville dryer not heating" — competitors (Mr. Appliance, Hoffmann Bros, Sears) cited instead. Off-site signals (Yelp/GBP category, legacy tnappliancerepair.com) are the lever there.',
      queries: TARGET_QUESTIONS,
    },
    asset_health: health,
    gsc: ranks,
  });
};
