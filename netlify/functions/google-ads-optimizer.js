// google-ads-optimizer — the profit-governed autopilot + daily scoreboard digest.
// SAFE day-one levers only (per the launch plan): (1) auto-add junk/wrong-intent
// search terms as negative keywords (kills the "used appliance / parts / jobs"
// waste that the used-store legacy attracts), (2) flag zero-converting keyword
// spend. Budget/bid changes stay MANUAL until ~2 weeks of conversion data.
// Then it texts Teddy the scoreboard + what it did/found.
//
// SHADOW by default (suggest only). Set vault GOOGLE_ADS_AUTOPILOT=true to let it
// actually add negatives + pause waste. Hard kill: GOOGLE_ADS_AUTOPILOT=off.
//   manual: GET ?secret=   ·   ?dryrun=1 forces shadow even if autopilot on
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const ads = require('./_lib/google-ads');
const sb = require('./google-ads-scoreboard');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// wrong-intent tokens for an appliance-REPAIR ad. A search term containing any of
// these (whole word) = someone NOT looking to hire a repair tech → negative it.
const JUNK = ['used', 'sell', 'selling', 'sale', 'buy', 'buying', 'cheap', 'scrap', 'dent', 'rent', 'rental', 'salary', 'job', 'jobs', 'hiring', 'hire', 'career', 'careers', 'free', 'manual', 'schematic', 'craigslist', 'marketplace', 'recall', 'lawsuit', 'wholesale', 'liquidation', 'pallet', 'auction'];
const WASTE_SPEND = 25;   // a keyword that spent >= $25 with 0 conversions = waste candidate
const re = (w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, 'i');

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const manual = q.secret != null;
  if (manual && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const flag = String((await getSecret('GOOGLE_ADS_AUTOPILOT')) || '').toLowerCase();
  if (flag === 'off') return json(200, { ok: true, skipped: 'autopilot=off (hard kill)' });
  const LIVE = flag === 'true' && q.dryrun !== '1';

  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false });
  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const base = `https://googleads.googleapis.com/${c.version}/customers/${cid}`;
  async function api(path, body) {
    let r, d;
    try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
    if (!r.ok && r.status === 403 && c.managerId) { try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); } catch (_) {} }
    return { ok: r.ok, d, err: r.ok ? null : ((d.error && d.error.message) || d) };
  }
  const search = async (gaql) => (await api('/googleAds:search', { query: gaql }));

  // only ever touch OUR Ant campaigns
  const onlyAnt = `campaign.name LIKE '%(Ant)%' AND campaign.status = 'ENABLED'`;

  // 1) JUNK SEARCH TERMS -> negative keywords
  const stRes = await search(`SELECT search_term_view.search_term, campaign.id, campaign.resource_name, metrics.clicks, metrics.cost_micros FROM search_term_view WHERE segments.date DURING LAST_30_DAYS AND ${onlyAnt}`);
  const junkTerms = [];
  if (stRes.ok) {
    for (const x of (stRes.d.results || [])) {
      const term = (x.searchTermView && x.searchTermView.searchTerm) || '';
      const hit = JUNK.find((w) => re(w).test(term));
      if (hit) junkTerms.push({ term, reason: hit, campaign: x.campaign.resourceName, clicks: Number(x.metrics.clicks || 0), cost: Math.round((Number(x.metrics.costMicros || 0) / 1e6) * 100) / 100 });
    }
  }
  let negsAdded = 0;
  if (LIVE && junkTerms.length) {
    const ops = junkTerms.map((j) => ({ create: { campaign: j.campaign, negative: true, keyword: { text: j.term, matchType: 'PHRASE' } } }));
    const m = await api('/campaignCriteria:mutate', { partialFailure: true, operations: ops });
    negsAdded = (m.d && m.d.results ? m.d.results.filter(Boolean).length : 0);
  }

  // 2) ZERO-CONVERTING KEYWORD SPEND -> waste flag (pause only when LIVE)
  const kwRes = await search(`SELECT ad_group_criterion.keyword.text, ad_group_criterion.resource_name, metrics.cost_micros, metrics.conversions FROM keyword_view WHERE segments.date DURING LAST_14_DAYS AND ${onlyAnt}`);
  const waste = [];
  let totalConv = 0;
  if (kwRes.ok) {
    for (const x of (kwRes.d.results || [])) {
      const cost = Number(x.metrics.costMicros || 0) / 1e6, conv = Number(x.metrics.conversions || 0);
      totalConv += conv;
      if (cost >= WASTE_SPEND && conv === 0) waste.push({ kw: x.adGroupCriterion.keyword.text, resource: x.adGroupCriterion.resourceName, cost: Math.round(cost * 100) / 100 });
    }
  }
  // SAFETY: never pause on "zero conversions" unless tracking is demonstrably alive
  // (the account has recorded at least one conversion). Otherwise silent tracking
  // would make every keyword look like waste and we'd pause the winners.
  const trackingAlive = totalConv > 0;
  let paused = 0;
  if (LIVE && trackingAlive && waste.length) {
    const ops = waste.map((w) => ({ update: { resourceName: w.resource, status: 'PAUSED' }, updateMask: 'status' }));
    const m = await api('/adGroupCriteria:mutate', { partialFailure: true, operations: ops });
    paused = (m.d && m.d.results ? m.d.results.filter(Boolean).length : 0);
  }

  // 3) scoreboard for the digest
  let board = { ok: false };
  try { board = await sb.fetchScoreboard('LAST_7_DAYS'); } catch (_) {}

  // 4) daily digest to Teddy
  const t = (board.ok && board.totals) || {};
  const mode = LIVE ? 'AUTOPILOT' : 'shadow';
  let msg = `🥊 Google Ads (7d, ${mode}): $${(t.cost || 0).toFixed ? t.cost.toFixed(2) : t.cost} · ${t.clicks || 0} clicks · ${t.conversions || 0} booked` + (t.cost_per_conv ? ` · $${t.cost_per_conv}/booked` : ' · no conversions yet');
  if (junkTerms.length) msg += `\n🗑 junk terms: ${junkTerms.length}${LIVE ? ` (added ${negsAdded} negatives)` : ' (shadow — turn on autopilot to auto-block)'} e.g. "${junkTerms.slice(0, 3).map((j) => j.term).join('", "')}"`;
  if (waste.length) msg += `\n⚠️ zero-converting spend: ${waste.length} kw, $${waste.reduce((a, w) => a + w.cost, 0).toFixed(2)}${LIVE ? (trackingAlive ? ` (paused ${paused})` : ' (NOT paused — no tracked conversions yet, won\'t touch winners)') : ' (shadow)'}`;
  if (!junkTerms.length && !waste.length) msg += `\n✓ nothing to clean up.`;
  // text once/day unless manual
  try { await sendSms('+16154855795', msg, 'owner', 'google_ads_optimizer'); } catch (_) {}

  return json(200, { ok: true, mode, scoreboard: board.ok ? board.totals : null, junk_terms: junkTerms.length, negatives_added: negsAdded, waste_keywords: waste.length, paused, junk_sample: junkTerms.slice(0, 10), waste_sample: waste.slice(0, 10) });
};
