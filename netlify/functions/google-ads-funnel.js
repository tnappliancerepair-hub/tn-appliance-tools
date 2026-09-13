// google-ads-funnel — send every appliance-specific query to the ad group built for it.
//
// THE REBALANCE ALREADY HAPPENED, AND THE 30-DAY NUMBER HIDES IT. The themed ad groups
// went live 2026-09-09. Daily spend by group proves it: 09-08 was 100% the broad
// After-Hours group, 09-12 the broad group spent $0.00 and all $56.28 landed in the
// appliance groups. The "87% in one broad group" figure is a trailing 30-day average
// that still carries the nine days before the flip.
//
// What is actually still leaking is STRUCTURE, not budget. Google Ads has NO per-ad-group
// budget — a campaign budget goes to whichever ad group wins the auction first, and the
// broad group wins on accumulated Quality Score history (4,356 impressions of it) even for
// queries a themed group was purpose-built to catch. Measured over 30 days: 430 queries
// carrying an appliance noun ($105.82 / 26 clicks) landed in a broad group instead of the
// themed group that has the matching ad copy AND the prefilled landing page
// (appliance-ai.html?appliance=<x>). That is the click we paid for and then handed a
// generic page.
//
// The fix is an ad-group negative funnel: block the appliance nouns in the broad group so
// those queries can ONLY land in their themed group. It makes the rebalance structural
// instead of dependent on which keywords happen to be paused this week.
//
// ⚠️ AFTER-HOURS IS EXCLUDED BY DEFAULT, ON PURPOSE. Its four live keywords are all
// time-qualified — "appliance repair open now", "emergency appliance repair",
// "24 hour appliance repair", "appliance repair tonight". Answering at 2am is the shop's
// actual differentiator, and no themed group carries that time intent, so blocking
// "emergency refrigerator repair" there would lose the query outright rather than move it.
// &include_afterhours=1 opts in.
//
// ⚠️ MICROWAVE IS NOT IN THE FUNNEL. There is no microwave ad group, so negativing it out
// of the broad groups would block the query entirely instead of routing it. A noun only
// belongs in the funnel once a themed group can catch it.
//
// PREVIEW BY DEFAULT. &apply=1 writes (requires an explicit &step=). &revert=1 undoes.
//   GET ?secret=<admin>[&step=funnel|keywords|prune|guard|all][&apply=1][&revert=1]
//                      [&include_afterhours=1][&campaign=<id>]
'use strict';

const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');

const DEFAULT_CAMPAIGN = '24154623729';   // After-Hours Appliance Repair — Nashville Metro
const AFTER_HOURS = 'After-Hours ad group';
const GENERAL = 'Appliance Repair — General';

// Appliance nouns that get funnelled out of the broad group(s). Every entry must have a
// themed group that can catch it — see the microwave note above.
const FUNNEL_NOUNS = [
  'refrigerator', 'fridge', 'freezer', 'ice maker',
  'washer', 'washing machine', 'laundry',
  'dryer', 'dishwasher',
  'oven', 'range', 'stove', 'cooktop',
];

// Keywords the themed groups are missing. Harvested from search terms this account has
// actually been billed for, plus the symptom language the trade uses. PHRASE only — broad
// match here would re-create the leak we are closing.
const ADD_KEYWORDS = {
  'Refrigerator Repair': ['refrigerator repair nashville', 'fridge repair', 'freezer repair', 'ice maker repair', 'refrigerator leaking water', 'refrigerator not making ice'],
  'Washer Repair': ['washing machine repair nashville', 'washer not spinning', 'washer wont drain', 'washing machine not draining', 'washer leaking'],
  'Dryer Repair': ['dryer repair nashville', 'dryer not drying', 'dryer making noise', 'dryer wont start', 'dryer not spinning'],
  'Dishwasher Repair': ['dishwasher repair nashville', 'dishwasher not draining', 'dishwasher leaking', 'dishwasher wont start', 'dishwasher not cleaning'],
  'Oven & Range Repair': ['oven not heating', 'range repair', 'cooktop repair', 'stove burner not working', 'oven repair nashville', 'gas stove repair near me'],
};

// Money spent, nobody called. Paused, not deleted, so the history survives for a re-read.
const PRUNE = [
  { ad_group: GENERAL, text: 'appliance repair company', why: '$39.01 / 11 clicks / 0 conversions in 7 days — the most expensive live keyword in the account and the worst performer. A comparison-shopping query, not an emergency one.' },
];

// Wrong trade. A pressure washer is not an appliance we fix, and "washer" keywords will
// pick it up. Neither is blocked today (checked live: 103 campaign negatives, none match).
const GUARD_NEGATIVES = ['pressure washer', 'power washer'];

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'admin secret required (?secret=)' });

  const apply = q.apply === '1';
  const revert = q.revert === '1';
  const step = String(q.step || 'all').toLowerCase();
  const includeAfterHours = q.include_afterhours === '1';
  const campaignId = String(q.campaign || DEFAULT_CAMPAIGN).replace(/\D/g, '');
  if (!campaignId) return json(200, { ok: false, error: 'bad campaign id' });
  if (apply && step === 'all') return json(200, { ok: false, error: 'apply needs an explicit &step= (funnel | keywords | prune | guard) — one blast radius at a time' });

  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false });
  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const base = `https://googleads.googleapis.com/${c.version}/customers/${cid}`;

  async function call(path, body, login) {
    const r = await fetch(base + path, { method: 'POST', headers: ads.apiHeaders(token, c, login || cid), body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok && r.status === 403 && c.managerId && !login) return call(path, body, c.managerId);
    return { ok: r.ok, status: r.status, d };
  }
  async function search(gaql) { const r = await call('/googleAds:search', { query: gaql }); return { ...r, rows: (r.d && r.d.results) || [] }; }

  // partialFailure OFF and a sent-vs-applied compare. A partial-failure mutate returns ok
  // while silently dropping every operation — that is how the ad schedule got wiped once.
  async function mutate(path, ops, label) {
    if (!ops.length) return { ok: true, applied: 0, skipped: 'nothing to do' };
    const res = await call(path, { operations: ops, partialFailure: false });
    const applied = ((res.d && res.d.results) || []).length;
    if (!res.ok || applied !== ops.length) {
      return { ok: false, error: `${label}: mutate did not apply`, sent: ops.length, applied, status: res.status, detail: (res.d && res.d.error) || res.d };
    }
    return { ok: true, applied };
  }

  // ---- live picture -------------------------------------------------------------------
  const agRes = await search(`SELECT ad_group.id, ad_group.name, ad_group.status FROM ad_group WHERE campaign.id = ${campaignId} AND ad_group.status != 'REMOVED'`);
  if (!agRes.ok) return json(200, { ok: false, error: 'could not read ad groups', status: agRes.status, detail: agRes.d });
  const groups = {};
  for (const r of agRes.rows) groups[r.adGroup.name] = { id: r.adGroup.id, status: r.adGroup.status, res: r.adGroup.resourceName };

  const kwRes = await search(`SELECT ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.negative FROM ad_group_criterion WHERE campaign.id = ${campaignId} AND ad_group_criterion.type = KEYWORD AND ad_group_criterion.status != 'REMOVED'`);
  const live = kwRes.rows.map((r) => ({
    ad_group: r.adGroup.name,
    text: String(r.adGroupCriterion.keyword.text || '').toLowerCase(),
    match: r.adGroupCriterion.keyword.matchType,
    status: r.adGroupCriterion.status,
    negative: !!r.adGroupCriterion.negative,
    res: r.adGroupCriterion.resourceName,
  }));
  const has = (ag, text, neg) => live.some((k) => k.ad_group === ag && k.text === String(text).toLowerCase() && !!k.negative === !!neg);
  const find = (ag, text, neg) => live.find((k) => k.ad_group === ag && k.text === String(text).toLowerCase() && !!k.negative === !!neg);

  const broadTargets = [GENERAL].concat(includeAfterHours ? [AFTER_HOURS] : []).filter((n) => groups[n]);

  // ---- plan ---------------------------------------------------------------------------
  const plan = { campaign: campaignId, mode: revert ? 'revert' : (apply ? 'apply' : 'preview'), step, funnel: [], keywords: [], prune: [], guard: [] };

  for (const ag of broadTargets) {
    for (const noun of FUNNEL_NOUNS) {
      const already = has(ag, noun, true);
      if (revert ? already : !already) plan.funnel.push({ ad_group: ag, negative: noun, match: 'PHRASE' });
    }
  }
  for (const [ag, list] of Object.entries(ADD_KEYWORDS)) {
    if (!groups[ag]) continue;
    for (const text of list) {
      const already = has(ag, text, false);
      if (revert ? already : !already) plan.keywords.push({ ad_group: ag, keyword: text, match: 'PHRASE' });
    }
  }
  for (const p of PRUNE) {
    const k = find(p.ad_group, p.text, false);
    if (!k) continue;
    const want = revert ? 'ENABLED' : 'PAUSED';
    if (k.status !== want) plan.prune.push({ ...p, from: k.status, to: want });
  }

  const cnRes = await search(`SELECT campaign_criterion.criterion_id, campaign_criterion.keyword.text FROM campaign_criterion WHERE campaign.id = ${campaignId} AND campaign_criterion.negative = true AND campaign_criterion.type = KEYWORD`);
  const cneg = cnRes.rows.map((r) => ({ text: String(r.campaignCriterion.keyword.text || '').toLowerCase(), res: r.campaignCriterion.resourceName }));
  for (const g of GUARD_NEGATIVES) {
    const hit = cneg.find((x) => x.text === g);
    if (revert ? hit : !hit) plan.guard.push({ campaign_negative: g, match: 'PHRASE' });
  }

  const counts = { funnel: plan.funnel.length, keywords: plan.keywords.length, prune: plan.prune.length, guard: plan.guard.length };

  if (!apply && !revert) {
    return json(200, {
      ok: true, mode: 'preview', campaign: campaignId, counts, plan,
      after_hours: includeAfterHours ? 'INCLUDED in the funnel' : 'excluded on purpose — its live keywords are time-qualified (open now / emergency / 24 hour / tonight) and no themed group carries that intent. &include_afterhours=1 to include.',
      note: 'add &step=<funnel|keywords|prune|guard>&apply=1 to write one step; &revert=1 undoes it.',
    });
  }

  // ---- write --------------------------------------------------------------------------
  const done = {};
  const wants = (s) => step === s;

  if (wants('funnel')) {
    const ops = plan.funnel.map((f) => (revert
      ? { remove: find(f.ad_group, f.negative, true).res }
      : { create: { adGroup: `customers/${cid}/adGroups/${groups[f.ad_group].id}`, negative: true, keyword: { text: f.negative, matchType: 'PHRASE' } } }));
    done.funnel = await mutate('/adGroupCriteria:mutate', ops, 'funnel');
    if (!done.funnel.ok) return json(200, { ok: false, step, plan, result: done });
  }

  if (wants('keywords')) {
    const ops = plan.keywords.map((k) => (revert
      ? { remove: find(k.ad_group, k.keyword, false).res }
      : { create: { adGroup: `customers/${cid}/adGroups/${groups[k.ad_group].id}`, status: 'ENABLED', keyword: { text: k.keyword, matchType: 'PHRASE' } } }));
    done.keywords = await mutate('/adGroupCriteria:mutate', ops, 'keywords');
    if (!done.keywords.ok) return json(200, { ok: false, step, plan, result: done });
  }

  if (wants('prune')) {
    const ops = plan.prune.map((p) => ({ update: { resourceName: find(p.ad_group, p.text, false).res, status: p.to }, updateMask: 'status' }));
    done.prune = await mutate('/adGroupCriteria:mutate', ops, 'prune');
    if (!done.prune.ok) return json(200, { ok: false, step, plan, result: done });
  }

  if (wants('guard')) {
    const ops = plan.guard.map((g) => (revert
      ? { remove: cneg.find((x) => x.text === g.campaign_negative).res }
      : { create: { campaign: `customers/${cid}/campaigns/${campaignId}`, negative: true, keyword: { text: g.campaign_negative, matchType: 'PHRASE' } } }));
    done.guard = await mutate('/campaignCriteria:mutate', ops, 'guard');
    if (!done.guard.ok) return json(200, { ok: false, step, plan, result: done });
  }

  // Prove it off the account, not off the 200.
  const after = await search(`SELECT ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.status, ad_group_criterion.negative FROM ad_group_criterion WHERE campaign.id = ${campaignId} AND ad_group_criterion.type = KEYWORD AND ad_group_criterion.status != 'REMOVED'`);
  const now = after.rows.map((r) => ({ ad_group: r.adGroup.name, text: String(r.adGroupCriterion.keyword.text || '').toLowerCase(), status: r.adGroupCriterion.status, negative: !!r.adGroupCriterion.negative }));
  const nowHas = (ag, t, neg) => now.some((k) => k.ad_group === ag && k.text === String(t).toLowerCase() && !!k.negative === !!neg);

  const verify = { step, ok: true, checked: 0, failed: [] };
  if (wants('funnel')) for (const f of plan.funnel) { verify.checked++; if (nowHas(f.ad_group, f.negative, true) === revert) verify.failed.push(f); }
  if (wants('keywords')) for (const k of plan.keywords) { verify.checked++; if (nowHas(k.ad_group, k.keyword, false) === revert) verify.failed.push(k); }
  if (wants('prune')) for (const p of plan.prune) { verify.checked++; const k = now.find((x) => x.ad_group === p.ad_group && x.text === p.text && !x.negative); if (!k || k.status !== p.to) verify.failed.push(p); }
  if (wants('guard')) {
    const cn2 = await search(`SELECT campaign_criterion.keyword.text FROM campaign_criterion WHERE campaign.id = ${campaignId} AND campaign_criterion.negative = true AND campaign_criterion.type = KEYWORD`);
    const texts = cn2.rows.map((r) => String(r.campaignCriterion.keyword.text || '').toLowerCase());
    for (const g of plan.guard) { verify.checked++; if (texts.includes(g.campaign_negative) === revert) verify.failed.push(g); }
  }
  verify.ok = verify.failed.length === 0;

  return json(200, {
    ok: verify.ok, mode: revert ? 'reverted' : 'applied', step, campaign: campaignId, counts, plan, result: done, verified: verify,
    note: verify.ok ? 'Read back off the account and it agrees.' : 'WRITE REPORTED OK BUT READ-BACK DISAGREES — check the account.',
  });
};
