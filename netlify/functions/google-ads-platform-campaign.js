// google-ads-platform-campaign — sell the platform to other repair shops.
//
// This is a SEPARATE campaign with its OWN budget. It must never be carved out of
// the $45/day feeding appliance leads: that budget is this week's rent, this one is
// next year's business, and mixing them means a slow month in SaaS quietly starves
// the jobs that pay the bills.
//
// WHAT WE ARE SELLING: the whole shop, not a phone bot. That decision picks our
//   competitors for us - Housecall Pro, Jobber, Workiz, ServiceTitan - and that is
//   the favorable fight. ServiceTitan runs $300-500 PER TECH; we're $99-329 for the
//   shop. They're all generic across trades. And not one of them answers the phone -
//   they assume a human picks up. Nobody sells the combination.
//
// WHY WE DO NOT BID "ai phone system": Podium, Slang.ai, Goodcall and Smith.ai own
//   those head terms at $15-40 a click chasing dentists and med spas. At any budget
//   we'd sanely set we'd buy two clicks a day in the most expensive room in the
//   building. The AI phone is what makes us worth noticing, not what anyone types.
//
// THE ANGLE THEY CANNOT COPY: built by a working appliance tech, and you can bring
//   your book over from their software in an afternoon and run both until you're
//   sure. The import wizard is already live against 24k real Housecall Pro jobs, so
//   that promise is code, not copy.
//
//   GET ?secret=              preview: the whole plan, writes NOTHING
//   ...&apply=1               build it, PAUSED (you flip it on when you're ready)
//   ...&apply=1&enable=1      build it and start spending
//   ...&undo=1&apply=1        pause the campaign again
//   optional: &budget=20      dollars/day (default 20)   &cpc=6   max CPC dollars
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

const SITE = 'https://tnapplianceexchange.net';
const CAMPAIGN_NAME = 'Ant Platform - Repair Shops';
const US = 'geoTargetConstants/2840';

// Somebody who just searched "housecall pro alternative" wants one question
// answered - can I get my data out and what breaks - so they land on the page that
// answers it, not on a general product page. Everyone else lands on home.
const PAGE = { switching: 'switch.html' };
const land = (tag) => `${SITE}/platform/${PAGE[tag] || 'home.html'}?utm_source=google_ads&utm_medium=cpc&utm_campaign=ant_platform&utm_content=${tag}`;

// True for every group, and the reason to pick us over a phone bot.
const TRUST_H = ['Run Your Whole Shop', 'Not Just a Phone Bot', 'Free 14-Day Trial'];
const TRUST_D = 'Built by a working appliance tech who got tired of missing calls. Free 14-day trial.';

// Ordered by intent, not by what's most exciting to talk about. Somebody typing
// "housecall pro alternative" has already decided to leave - we're catching them,
// not convincing them, and that is the cheapest lead in B2B software. The AI phone
// goes LAST on purpose: it's what makes us worth a second look, but it is not what
// anyone is searching for at the moment they're ready to switch.
//
// TRADEMARK RULE: competitor names are fine as KEYWORDS and get an ad DISAPPROVED in
// ad TEXT. So we bid "housecall pro alternative" and never write it in a headline.
// The searcher already has the name in their head; we just have to be the answer.
const GROUPS = [
  {
    key: 'switching',
    name: 'Switching Software - Repair Shops',
    kw: [
      'housecall pro alternative',
      'jobber alternative',
      'workiz alternative',
      'servicetitan alternative',
      'alternative to housecall pro',
      'field service software switch',
    ],
    headlines: ['We Move Your Data Free', 'Free to Try, Free to Leave', 'Keep Your Old System Too', 'Built by an Appliance Tech'],
    descriptions: ['Free to start. We move your customers and jobs for you. Keep your old system running.'],
  },
  {
    key: 'shop-software',
    name: 'Shop Software - Repair Shops',
    kw: [
      'appliance repair software',
      'appliance repair business software',
      'appliance repair scheduling software',
      'software for appliance repair company',
      'field service software small business',
      'field service software for small shops',
    ],
    headlines: ['Software to Run Your Shop', 'Board, Dispatch, Invoices', 'Made for Repair Shops', 'Built by an Appliance Tech'],
    descriptions: ['One system: phones, scheduling, dispatch, parts, invoices, tech pay. Not five tabs.'],
  },
  {
    key: 'ai-answering',
    name: 'AI Answering - Repair Shops',
    kw: [
      'ai receptionist for repair shop',
      'answering service for appliance repair',
      'answering service for contractors',
      'after hours answering service',
      'ai phone agent for service business',
    ],
    headlines: ['Your Software Answers It', 'Never Miss a Repair Call', 'Books the Job, Not a Note', 'Built by an Appliance Tech'],
    descriptions: ['The only shop software that answers your phone. Books the job straight onto your board.'],
  },
];

// The med-spa crowd is who the funded players are chasing. We pay for none of it.
// Also blocked: people looking to BUILD one, get hired by one, or read about one.
const NEGATIVES = [
  'dentist', 'dental', 'medical', 'doctor', 'clinic', 'chiropractor', 'veterinary', 'med spa',
  'restaurant', 'salon', 'spa', 'hotel', 'real estate', 'realtor', 'law firm', 'lawyer', 'attorney',
  'insurance agency', 'car dealership', 'ecommerce',
  'free', 'freeware', 'open source', 'github', 'api', 'python', 'build your own', 'diy',
  'jobs', 'hiring', 'salary', 'career', 'resume', 'course', 'tutorial', 'how to build',
  'reddit', 'wikipedia', 'review of', 'vs',
];

const dig = (s) => String(s || '').replace(/\D/g, '');

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized - ?secret=' });

  // The vault flakes on Ads creds now and then; every caller retries once.
  let c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false, hint: 'Google Ads creds unavailable (vault).' });

  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const base = `https://googleads.googleapis.com/${c.version}/customers/${cid}`;
  const apply = q.apply === '1';
  const undo = q.undo === '1';
  const enable = q.enable === '1';
  const budget = Math.max(5, Math.min(200, parseInt(q.budget, 10) || 20));
  const cpc = Math.max(1, Math.min(30, parseInt(q.cpc, 10) || 6));

  async function post(path, body) {
    let r, d;
    try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); }
    catch (e) { return { ok: false, err: String(e.message || e) }; }
    if (!r.ok && r.status === 403 && c.managerId) {
      try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); } catch (_) {}
    }
    const det = d.error && d.error.details && d.error.details[0] && (d.error.details[0].errors || d.error.details[0]);
    return { ok: r.ok, status: r.status, d, err: r.ok ? null : { message: (d.error && d.error.message) || null, detail: det || null } };
  }
  const search = (query) => post('/googleAds:search', { query });

  // Google silently rejects an over-length RSA asset, and partialFailure would hide
  // it. Check before we send rather than deploying an ad with missing headlines.
  const tooLong = [];
  GROUPS.forEach((g) => {
    g.headlines.concat(TRUST_H).forEach((h) => { if (h.length > 30) tooLong.push({ group: g.key, type: 'headline', len: h.length, text: h }); });
    g.descriptions.concat([TRUST_D]).forEach((d) => { if (d.length > 90) tooLong.push({ group: g.key, type: 'description', len: d.length, text: d }); });
  });
  if (tooLong.length) return json(200, { ok: false, error: 'asset_too_long', over: tooLong });

  // Already built? Never create a second copy - two campaigns on the same keywords
  // bid against each other with your own money.
  const found = await search(`SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.name = '${CAMPAIGN_NAME}'`);
  const existing = ((found.d && found.d.results) || [])[0];
  const existingId = existing && existing.campaign && existing.campaign.id;

  if (undo) {
    if (!existingId) return json(200, { ok: false, error: 'nothing to undo - campaign not found' });
    if (!apply) return json(200, { ok: true, mode: 'PREVIEW', would_pause: CAMPAIGN_NAME, id: existingId, apply_with: '&undo=1&apply=1' });
    const r = await post('/campaigns:mutate', { operations: [{ update: { resourceName: `customers/${cid}/campaigns/${existingId}`, status: 'PAUSED' }, updateMask: 'status' }] });
    return json(200, { ok: r.ok, paused: CAMPAIGN_NAME, id: existingId, err: r.err });
  }

  const plan = {
    campaign: CAMPAIGN_NAME,
    daily_budget: `$${budget}`,
    monthly_ceiling: `about $${budget * 30}`,
    geo: 'United States (shops anywhere - this is not a local business)',
    bidding: `manual CPC, max $${cpc}`,
    network: 'Google Search only (no display, no search partners)',
    landing: land('<group>'),
    ad_groups: GROUPS.map((g) => ({ name: g.name, keywords: g.kw.map((k) => `"${k}" (phrase)`), headlines: g.headlines.concat(TRUST_H), descriptions: g.descriptions.concat([TRUST_D]) })),
    negative_keywords: NEGATIVES.length + ' terms: ' + NEGATIVES.slice(0, 12).join(', ') + ', ...',
    deliberately_not_bidding: ['ai phone system', 'ai receptionist', 'ai answering service'].concat(['- the funded players own these at $15-40/click']),
  };

  if (!apply) {
    return json(200, {
      ok: true, mode: 'PREVIEW - nothing written, nothing spent',
      already_exists: existingId ? { id: existingId, status: existing.campaign.status } : false,
      plan,
      apply_with: '&apply=1 (creates it PAUSED) or &apply=1&enable=1 (creates it running)',
    });
  }
  if (existingId) return json(200, { ok: false, error: 'campaign_already_exists', id: existingId, status: existing.campaign.status, note: 'Edit it in the dashboard, or &undo=1&apply=1 to pause it. Building a second copy would bid against the first.' });

  // ── APPLY ───────────────────────────────────────────────────────────────────
  const stamp = Date.now();
  const bud = await post('/campaignBudgets:mutate', {
    operations: [{ create: { name: `${CAMPAIGN_NAME} budget ${stamp}`, amountMicros: budget * 1000000, deliveryMethod: 'STANDARD', explicitlyShared: false } }],
  });
  const budRes = bud.ok && bud.d.results && bud.d.results[0] && bud.d.results[0].resourceName;
  if (!budRes) return json(200, { ok: false, step: 'budget', err: bud.err });

  const camp = await post('/campaigns:mutate', {
    operations: [{ create: {
      name: CAMPAIGN_NAME,
      status: enable ? 'ENABLED' : 'PAUSED',
      advertisingChannelType: 'SEARCH',
      campaignBudget: budRes,
      manualCpc: {},
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
    } }],
  });
  const campRes = camp.ok && camp.d.results && camp.d.results[0] && camp.d.results[0].resourceName;
  if (!campRes) return json(200, { ok: false, step: 'campaign', err: camp.err, note: 'Budget was created; delete it in the dashboard before retrying so it does not orphan.' });

  const geo = await post('/campaignCriteria:mutate', {
    operations: [{ create: { campaign: campRes, location: { geoTargetConstant: US } } }],
  });

  // Campaign-level negatives so every group inherits them from the first impression.
  const neg = await post('/campaignCriteria:mutate', {
    partialFailure: true,
    operations: NEGATIVES.map((text) => ({ create: { campaign: campRes, negative: true, keyword: { text, matchType: 'BROAD' } } })),
  });
  const negOk = ((neg.d && neg.d.results) || []).length;

  const built = [];
  for (const g of GROUPS) {
    const ag = await post('/adGroups:mutate', {
      operations: [{ create: { name: g.name, campaign: campRes, status: 'ENABLED', type: 'SEARCH_STANDARD', cpcBidMicros: cpc * 1000000 } }],
    });
    const agRes = ag.ok && ag.d.results && ag.d.results[0] && ag.d.results[0].resourceName;
    if (!agRes) { built.push({ group: g.key, ok: false, step: 'ad_group', err: ag.err }); continue; }

    const kw = await post('/adGroupCriteria:mutate', {
      partialFailure: true,
      operations: g.kw.map((text) => ({ create: { adGroup: agRes, status: 'ENABLED', keyword: { text, matchType: 'PHRASE' } } })),
    });
    const ad = await post('/adGroupAds:mutate', {
      operations: [{ create: { adGroup: agRes, status: 'ENABLED', ad: { finalUrls: [land(g.key)], responsiveSearchAd: {
        headlines: g.headlines.concat(TRUST_H).map((text) => ({ text })),
        descriptions: g.descriptions.concat([TRUST_D]).map((text) => ({ text })),
      } } } }],
    });
    built.push({ group: g.key, ad_group: g.name, resource: agRes, keywords_sent: g.kw.length, keywords_ok: ((kw.d && kw.d.results) || []).length, ad_ok: ad.ok, errs: [kw.err, ad.err].filter(Boolean) });
  }

  return json(200, {
    ok: built.every((b) => b.resource && b.ad_ok !== false),
    campaign: CAMPAIGN_NAME,
    campaign_resource: campRes,
    status: enable ? 'ENABLED - spending now' : 'PAUSED - flip it on in the dashboard when you are ready',
    daily_budget: `$${budget}`,
    geo_ok: geo.ok,
    negatives_added: `${negOk} of ${NEGATIVES.length}`,
    ad_groups: built,
    next: 'Watch cost-per-signup, not clicks. If a paying shop costs more than a few months of their subscription, the keywords are wrong, not the budget.',
  });
};
