// meta-ads-create-campaign — stand up a targeted Facebook/Instagram campaign that
// promotes AssistAnt to SHOP OWNERS, leading with the referral hook ($99 flat, refer
// 4 shops = yours free, free setup). Campaign → ad set (US, small-business-owner
// audience) → creative (Page link post w/ the ant card) → ad. Previews with NO
// account (shows the exact plan); applies only with &apply=1 once the account +
// ads token are vaulted, and ALWAYS creates PAUSED so nothing spends until reviewed.
//
//   GET ?secret=<admin>[&budget=25&kit=referral|product]
//        preview: show campaign/adset/creative/ad plan + resolved targeting, write nothing
//   ...&apply=1   create it all, PAUSED (no spend until you flip it live in Ads Manager)
//
// Meta interest/behavior IDs are resolved live via the Targeting Search API on apply
// (first-real-tuning), so the audience is correct when it actually runs.
'use strict';
const { getSecret } = require('./_lib/secrets');
const meta = require('./_lib/meta-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

const SITE = 'https://tnapplianceexchange.net';
const IMAGE = SITE + '/referral-og.png';   // referral creative (falls back to assistant-og.png if unbuilt)

// Ad copy kits — leads with the referral/free hook (the strong B2B signal: cheap +
// peer-trusted + community). All claims are true to our own pages.
const KITS = {
  referral: {
    label: 'AssistAnt — Refer & Save',
    message: 'Run your whole appliance shop for $99/mo flat — every tech included, free setup. Bring a buddy shop on board and take $25/mo off your bill for each one. Four, and yours is free. Built by a real repair shop that runs on it every day. 🐜',
    headline: '$99/mo — Refer 4, Yours Is Free',
    description: 'Free setup. Ann answers 24/7. Bring your data off Housecall Pro in a day.',
    link: 'https://assistant247.net',
    cta: 'LEARN_MORE',
  },
  product: {
    label: 'AssistAnt — Run Your Shop',
    message: 'The AI system that answers every call 24/7, books the job, and runs your whole back office — $99/mo flat, every tech included, free setup. Built by a real appliance repair shop. 🐜',
    headline: 'Answer Every Call, Book Every Job',
    description: '$99/mo flat — no per-seat fees. AI receptionist + full office in one.',
    link: 'https://assistant247.net',
    cta: 'LEARN_MORE',
  },
};

// Audience: shop owners. Interests/behaviors resolved by name on apply.
const AUDIENCE_TERMS = ['Small business', 'Small business owners', 'Entrepreneurship', 'Home appliance', 'Business owner'];

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const kit = KITS[String(q.kit || 'referral').toLowerCase()] || KITS.referral;
  const budget = Math.max(5, Math.min(500, parseInt(q.budget, 10) || 25));   // daily $
  const apply = q.apply === '1';
  const c = await meta.creds();

  const targetingPlan = { geo_locations: { countries: ['US'] }, age_min: 25, age_max: 65, audience_terms: AUDIENCE_TERMS };
  const plan = {
    kit: q.kit || 'referral', daily_budget: budget, objective: 'OUTCOME_TRAFFIC', status: 'PAUSED',
    landing: kit.link, image: IMAGE, page_id: c.pageId || '(SOCIAL_FB_PAGE_ID)',
    headline: kit.headline, description: kit.description, primary_text: kit.message, cta: kit.cta,
    targeting: targetingPlan,
  };

  if (!apply) return json(200, { ok: true, mode: 'preview', configured: !!(c.acct && c.token), plan, note: 'add &apply=1 to create it PAUSED (no spend until you flip it live in Ads Manager). Preview needs no account.' });
  if (!c.acct || !c.token) return json(200, { ok: false, configured: false, error: 'META_AD_ACCOUNT_ID + META_ADS_TOKEN not vaulted', plan });
  if (!c.pageId) return json(200, { ok: false, error: 'META_PAGE_ID (or SOCIAL_FB_PAGE_ID) not vaulted — a Page is required to run an ad', plan });

  // Resolve real interest/behavior IDs by name (first-real-tuning). Any that resolve go
  // into flexible_spec; if none resolve, the ad set still runs on geo + age.
  const interests = [];
  for (const term of AUDIENCE_TERMS) {
    const hits = await meta.searchTargeting(term, c.token, 'adinterest');
    if (hits && hits[0] && hits[0].id) interests.push({ id: hits[0].id, name: hits[0].name });
  }
  const targeting = { geo_locations: { countries: ['US'] }, age_min: 25, age_max: 65 };
  if (interests.length) targeting.flexible_spec = [{ interests: interests.map((i) => ({ id: i.id, name: i.name })) }];

  // 1) campaign (PAUSED, traffic objective, no special ad category)
  const camp = await meta.api('POST', `/${c.act}/campaigns`, { name: kit.label + ' (Ant)', objective: 'OUTCOME_TRAFFIC', status: 'PAUSED', special_ad_categories: JSON.stringify([]) }, c.token);
  if (!camp.ok || !camp.data.id) return json(200, { ok: false, step: 'campaign', error: (camp.data && camp.data.error) || camp.data, plan });
  const campaignId = camp.data.id;

  // 2) ad set (daily budget, link-click optimization, the shop-owner audience, PAUSED)
  const adset = await meta.api('POST', `/${c.act}/adsets`, {
    name: kit.label + ' — US shop owners', campaign_id: campaignId, status: 'PAUSED',
    daily_budget: budget * 100, billing_event: 'IMPRESSIONS', optimization_goal: 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP', targeting: JSON.stringify(targeting),
  }, c.token);
  const adsetId = adset.ok ? adset.data.id : null;

  // 3) ad creative — a Page link post with the ant card + the referral copy + CTA button.
  let creativeId = null, creative = { ok: false };
  if (adsetId) {
    const spec = { page_id: c.pageId, link_data: { message: kit.message, link: kit.link, name: kit.headline, description: kit.description, picture: IMAGE, call_to_action: { type: kit.cta, value: { link: kit.link } } } };
    creative = await meta.api('POST', `/${c.act}/adcreatives`, { name: kit.label + ' creative', object_story_spec: JSON.stringify(spec) }, c.token);
    creativeId = creative.ok ? creative.data.id : null;
  }

  // 4) ad (PAUSED)
  let ad = { ok: false, err: 'skipped' };
  if (adsetId && creativeId) {
    ad = await meta.api('POST', `/${c.act}/ads`, { name: kit.label + ' ad', adset_id: adsetId, creative: JSON.stringify({ creative_id: creativeId }), status: 'PAUSED' }, c.token);
  }

  return json(200, {
    ok: !!(camp.ok && adsetId && creativeId && ad.ok), mode: 'created (paused)',
    campaign_id: campaignId, adset_id: adsetId, creative_id: creativeId, ad_id: ad.ok ? ad.data.id : null,
    resolved_interests: interests,
    steps: { campaign: camp.ok, adset: adset.ok, creative: creative.ok, ad: ad.ok },
    errors: { adset: adset.ok ? null : (adset.data && adset.data.error), creative: creative.ok ? null : (creative.data && creative.data.error), ad: ad.ok ? null : (ad.data && ad.data.error) },
    plan,
    note: 'Everything created PAUSED — review it in Ads Manager, then flip it live there (or with a status update). Nothing spends until you do.',
  });
};
