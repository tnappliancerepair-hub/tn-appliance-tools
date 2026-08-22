// google-ads-afterhours — the "spend where we're the only game in town" Search campaign.
// Encodes the after-hours plan (docs/after-hours-ads-plan-2026-08-20.md) in one command:
//   budget -> campaign (Manual CPC so the schedule bites) -> Nashville-metro geo ->
//   HOUR-BY-HOUR bid schedule (press evenings/nights/weekends, pull back 9-5) ->
//   campaign negatives -> ad group -> after-hours keywords -> responsive search ad.
// Lands on the AI chat intake, utm-tagged so every job attributes to `google_ads`.
//
//   GET ?secret=                 preview: resolve geo + show the whole plan, write NOTHING
//   ...&apply=1                  create it all, PAUSED (verify before a dollar spends)
//   ...&apply=1&enable=1         create it all + turn it ON
//   optional: &budget=30 &cities=Nashville,Antioch,... &final=<url>
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// ── the plan, as data ─────────────────────────────────────────────────────────
// Region-aware so TN and LA run as SEPARATE campaigns (they never compete in the same
// auction — different markets, different budgets). Pass &state= and &region= to retarget.
const DEFAULT_CITIES = ['Nashville', 'Antioch', 'Smyrna', 'Murfreesboro', 'La Vergne', 'Mount Juliet', 'Hendersonville', 'Franklin', 'Brentwood', 'Nolensville'];
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
// After-hours clicks land on the 24/7 moat page (message match: ad says "we answer at
// 2am" → page proves it + books). It carries a Get-booked CTA into the intake.
const finalFor = (region) => `https://tnapplianceexchange.net/always-open.html?utm_source=google_ads&utm_medium=cpc&utm_campaign=afterhours_${slug(region) || 'x'}`;

// Keywords — all-appliance repair intent + the after-hours goldmine nobody else bids on.
const KEYWORDS = [
  'appliance repair near me', 'appliance repair', 'same day appliance repair',
  'appliance repair open now', '24 hour appliance repair', 'emergency appliance repair', 'appliance repair tonight',
  'dryer repair near me', 'refrigerator repair near me', 'washer repair near me', 'dishwasher repair near me', 'oven repair near me',
  'fridge not cooling', 'dryer not heating',
];
// Campaign negatives — kill parts/used/DIY/hiring + the used-store ghost.
const NEGATIVES = ['used', 'for sale', 'parts', 'diy', 'how to', 'job', 'jobs', 'salary', 'rental', 'scrap', 'haul away', 'who buys', 'sell my', 'donate'];

// Lead with the moat — the 24/7 "we answer at 2am" headlines come FIRST (Google favors
// the early ones), then the supporting repair headlines. All ≤30 chars.
const HEADLINES = [
  'We Answer 24/7 · 365', 'Broken at 2am? We Answer', 'Open Now - 24/7 Repair', "Broken Tonight? We're Open",
  'Appliance Repair Near You', 'Same-Day Appliance Repair', 'Fridge, Dryer & Washer Fix', 'Honest Appliance Repair',
  'Chat or Text Us Now', 'Local Repair Pros', 'Family Owned Since 2012', 'Book Your Repair Online',
];
// Region-neutral copy (no "Middle TN") so the same ad is TRUE for TN and LA alike. ≤90 chars.
const DESCRIPTIONS = [
  'We answer 24/7, 365 - even at 2am. Chat now and book your repair tonight.',
  'Booked while everyone else is on voicemail. Real local techs, honest pricing.',
  'Fridge, dryer, washer, oven, dishwasher. Licensed, insured, 4.5 stars.',
  'Same-week service in your area. Broke after hours? We still answer.',
];

// THE DAYPARTING — bid modifiers by window. Base ad-group CPC is scaled by these, so
// with Manual CPC we literally press when competitors are dark and pull back when they're
// open. Every hour of the week is covered (an uncovered hour would not serve at all).
const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
const WEEKEND = ['SATURDAY', 'SUNDAY'];
const WEEKDAY_BLOCKS = [
  { s: 0, e: 7, mod: 1.0 },   // overnight — cheap, uncontested, anxious buyer
  { s: 7, e: 17, mod: 0.6 },  // 9-5-ish — competitors open + expensive, don't overpay
  { s: 17, e: 23, mod: 1.4 }, // evening — prime after-hours window, press
  { s: 23, e: 24, mod: 1.0 }, // late — moderate
];
const WEEKEND_BLOCKS = [
  { s: 0, e: 7, mod: 1.0 },
  { s: 7, e: 23, mod: 1.4 },  // weekend daytime — biggest uncontested window, press
  { s: 23, e: 24, mod: 1.0 },
];
function scheduleCriteria(campaign) {
  const out = [];
  const add = (days, blocks) => days.forEach((d) => blocks.forEach((b) =>
    out.push({ create: { campaign, bidModifier: b.mod, adSchedule: { dayOfWeek: d, startHour: b.s, startMinute: 'ZERO', endHour: b.e, endMinute: 'ZERO' } } })));
  add(WEEKDAYS, WEEKDAY_BLOCKS);
  add(WEEKEND, WEEKEND_BLOCKS);
  return out;
}

// ── PER-CITY DRYER + FRIDGE ad group (Teddy: "each LA city its own little ads, aimed at
// Louisiana customers, dryer + refrigerator primarily"). One ad group per city so a
// Baton Rouge searcher sees a Baton Rouge ad. City names live in the HEADLINES; the
// "yes—we service your area" promise lives in the descriptions (kept generic so a long
// city name can't blow the 90-char cap). Defensive length filters guarantee a valid RSA.
const clip = (arr, max) => arr.filter((s) => s && s.length <= max);
const dig = (s) => String(s || '').replace(/\D/g, '');
function cityAdGroup(city, stAbbr) {
  const kw = [
    `dryer repair ${city}`, `refrigerator repair ${city}`, `fridge repair ${city}`,
    `appliance repair ${city}`, `${city} dryer repair`, `${city} appliance repair`,
    'dryer repair near me', 'refrigerator repair near me', 'dryer not heating', 'fridge not cooling',
  ];
  // city-specific headlines (only those ≤30 survive), then strong generics to guarantee ≥3.
  const cityHeads = clip([
    `${city} Dryer Repair`, `${city} Fridge Repair`, `Dryer Repair in ${city}`,
    `We Service ${city}, ${stAbbr}`, `Yes—We Come to ${city}`, `${city} Appliance Repair`,
  ], 30);
  const genHeads = ['Same-Day Dryer & Fridge Fix', 'We Answer 24/7', "Broken Tonight? We're Open", 'Honest Local Repair', '$50 Quick Check', 'Fast, Honest, Local', 'Book Your Repair Online', 'Licensed & Insured'];
  const headlines = [...new Set([...cityHeads, ...genHeads])].slice(0, 15);
  const descriptions = clip([
    'Yes—we service your area across Louisiana. Dryer & refrigerator repair, honest pricing.',
    'Dryer not heating or fridge not cooling? We come to you. Book online in about a minute.',
    'We answer 24/7 when others are closed. Same-week service, licensed & insured.',
    'Real local techs, upfront pricing. 4.5 stars, 1,000+ reviews. Book your repair now.',
  ], 90);
  return { name: `${city} — Dryer & Fridge`, kw, headlines, descriptions };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const cities = String(q.cities || DEFAULT_CITIES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const STATE = String(q.state || 'Tennessee').trim();
  const region = String(q.region || 'Nashville Metro').trim();
  const budget = Math.max(5, Math.min(500, parseInt(q.budget, 10) || 30));
  const finalUrl = (q.final || '').trim() || finalFor(region);
  const baseCpc = Math.max(1, Math.min(20, parseInt(q.cpc, 10) || 4)); // $ base max CPC, scaled by the schedule
  const apply = q.apply === '1';
  const enable = q.enable === '1';
  const step = String(q.step || '').toLowerCase();     // '', 'shell', or 'city' (per-city flow)
  const stAbbr = String(q.st || (STATE.toLowerCase().startsWith('louis') ? 'LA' : STATE.slice(0, 2).toUpperCase())).toUpperCase();
  const callRaw = dig(q.call);                          // e.g. 2256051234 -> +12256051234 call asset
  const callNumber = callRaw ? (callRaw.length === 10 ? `+1${callRaw}` : (callRaw.startsWith('1') ? `+${callRaw}` : `+${callRaw}`)) : '';

  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false });
  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const base = `https://googleads.googleapis.com/${c.version}/customers/${cid}`;

  async function post(path, body) {
    let r, d;
    try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
    if (!r.ok && r.status === 403 && c.managerId) {
      try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); } catch (_) {}
    }
    const detail = d.error && d.error.details && d.error.details[0] && (d.error.details[0].errors || d.error.details[0]);
    return { ok: r.ok, status: r.status, d, err: r.ok ? null : { message: (d.error && d.error.message) || null, detail: detail || (d.error && d.error.status) || d } };
  }

  // ── STEP: change an existing campaign's daily budget ─────────────────────────────
  if (step === 'budget') {
    const campId = dig(q.campaign);
    if (!campId) return json(400, { ok: false, error: 'step=budget needs &campaign=<id> and &budget=' });
    const bq = await post('/googleAds:search', { query: `SELECT campaign.id, campaign.name, campaign_budget.resource_name, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${campId}` });
    const row = bq.ok && bq.d.results && bq.d.results[0];
    const budgetRes = row && row.campaignBudget && row.campaignBudget.resourceName;
    if (!budgetRes) return json(200, { ok: false, error: 'could not find campaign budget', detail: bq.err || bq.d });
    const oldMicros = row.campaignBudget.amountMicros;
    if (!apply) return json(200, { ok: true, mode: 'preview budget', campaign: campId, name: row.campaign && row.campaign.name, from_per_day: Math.round(oldMicros / 1e6), to_per_day: budget });
    const up = await post('/campaignBudgets:mutate', { operations: [{ update: { resourceName: budgetRes, amountMicros: budget * 1000000 }, updateMask: 'amount_micros' }] });
    return json(200, { ok: up.ok, mode: 'budget set', campaign: campId, name: row.campaign && row.campaign.name, from_per_day: Math.round(oldMicros / 1e6), to_per_day: budget, err: up.err });
  }

  // ── STEP: refresh the LIVE ads — new 24/7 RSA + /always-open landing, pause the old ─
  // Google ad text is immutable, so "updating" copy = create a fresh RSA then pause the
  // prior one. Applies the current HEADLINES/DESCRIPTIONS + finalUrl to every enabled ad
  // group on the campaign. Preview (no &apply=1) shows exactly what it will do.
  if (step === 'refreshad') {
    const campId = dig(q.campaign);
    if (!campId) return json(400, { ok: false, error: 'step=refreshad needs &campaign=<id>' });
    const sq = await post('/googleAds:search', { query: `SELECT ad_group.resource_name, ad_group_ad.resource_name FROM ad_group_ad WHERE campaign.id = ${campId} AND ad_group.status = 'ENABLED' AND ad_group_ad.status = 'ENABLED'` });
    if (!sq.ok) return json(200, { ok: false, error: 'search failed', detail: sq.err });
    const rows = sq.d.results || [];
    const groups = [...new Set(rows.map((r) => r.adGroup && r.adGroup.resourceName).filter(Boolean))];
    const oldAds = rows.map((r) => r.adGroupAd && r.adGroupAd.resourceName).filter(Boolean);
    if (!groups.length) return json(200, { ok: false, error: 'no enabled ad groups on that campaign' });
    if (!apply) return json(200, { ok: true, mode: 'preview refreshad', campaign: campId, ad_groups: groups.length, old_ads_to_pause: oldAds.length, new_final: finalUrl, new_headlines: HEADLINES, new_descriptions: DESCRIPTIONS });
    const created = [];
    for (const agRes of groups) {
      const ad = await post('/adGroupAds:mutate', { operations: [{ create: { adGroup: agRes, status: 'ENABLED', ad: { finalUrls: [finalUrl], responsiveSearchAd: { headlines: HEADLINES.map((t) => ({ text: t })), descriptions: DESCRIPTIONS.map((t) => ({ text: t })) } } } }] });
      created.push({ ad_group: agRes, ok: ad.ok, err: ad.err });
    }
    let paused = { ok: true, err: null };
    if (oldAds.length && created.some((x) => x.ok)) {
      paused = await post('/adGroupAds:mutate', { operations: oldAds.map((rn) => ({ update: { resourceName: rn, status: 'PAUSED' }, updateMask: 'status' })) });
    }
    return json(200, { ok: created.some((x) => x.ok), mode: 'ads refreshed', campaign: campId, new_ads: created, old_paused: { ok: paused.ok, count: oldAds.length, err: paused.err } });
  }

  // ── STEP: add ONE city's dryer/fridge ad group to an existing campaign ───────────
  // Small (3 API calls) so it never times out; call once per city after the shell.
  if (step === 'city') {
    const campId = dig(q.campaign);
    const city = String(q.city || '').trim();
    if (!campId || !city) return json(400, { ok: false, error: 'step=city needs &campaign=<id> and &city=' });
    const campRes = `customers/${cid}/campaigns/${campId}`;
    const g = cityAdGroup(city, stAbbr);
    if (!apply) return json(200, { ok: true, mode: 'preview city', city, ad_group: g.name, keywords: g.kw, headlines: g.headlines, descriptions: g.descriptions, final: finalUrl });
    const ag = await post('/adGroups:mutate', { operations: [{ create: { name: g.name, campaign: campRes, status: 'ENABLED', type: 'SEARCH_STANDARD', cpcBidMicros: baseCpc * 1000000 } }] });
    if (!ag.ok) return json(200, { ok: false, step: 'city_adgroup', city, error: ag.err });
    const agRes = ag.d.results[0].resourceName;
    const kw = await post('/adGroupCriteria:mutate', { partialFailure: true, operations: g.kw.map((t) => ({ create: { adGroup: agRes, status: 'ENABLED', keyword: { text: t, matchType: 'PHRASE' } } })) });
    const ad = await post('/adGroupAds:mutate', { operations: [{ create: { adGroup: agRes, status: 'ENABLED', ad: { finalUrls: [finalUrl], responsiveSearchAd: { headlines: g.headlines.map((t) => ({ text: t })), descriptions: g.descriptions.map((t) => ({ text: t })) } } } }] });
    return json(200, { ok: !!(ag.ok && ad.ok), mode: 'city added', city, ad_group: agRes, keywords: { ok: kw.ok, count: g.kw.length, err: kw.err }, ad: { ok: ad.ok, err: ad.err } });
  }

  // resolve City geo constants
  let geoResp;
  try {
    const gr = await fetch(`https://googleads.googleapis.com/${c.version}/geoTargetConstants:suggest`, {
      method: 'POST', headers: ads.apiHeaders(token, c),
      body: JSON.stringify({ locale: 'en', countryCode: 'US', locationNames: { names: cities.map((x) => `${x}, ${STATE}`) } }),
    });
    geoResp = await gr.json().catch(() => ({}));
  } catch (e) { return json(200, { ok: false, step: 'geo', error: String(e.message || e) }); }
  const sugg = geoResp.geoTargetConstantSuggestions || [];
  const geo = [];
  for (const city of cities) {
    const want = `${city.toLowerCase()},${STATE.toLowerCase()}`;
    const m = sugg.find((s) => s.geoTargetConstant && String(s.geoTargetConstant.canonicalName || '').toLowerCase().replace(/\s/g, '').includes(want.replace(/\s/g, '')) && s.geoTargetConstant.targetType === 'City')
      || sugg.find((s) => s.geoTargetConstant && String(s.geoTargetConstant.name || '').toLowerCase() === city.toLowerCase());
    if (m) geo.push({ city, resource: m.geoTargetConstant.resourceName, canonical: m.geoTargetConstant.canonicalName });
  }

  const name = `After-Hours Appliance Repair — ${region} (Ant)`;
  const plan = {
    campaign: name, status: enable ? 'ENABLED' : 'PAUSED', budget_per_day: budget, base_max_cpc: baseCpc,
    geo_resolved: geo.map((g) => g.canonical), geo_unresolved: cities.filter((ci) => !geo.find((g) => g.city === ci)),
    keywords: KEYWORDS, negatives: NEGATIVES, final_url: finalUrl,
    bid_schedule: { weekday: WEEKDAY_BLOCKS, weekend: WEEKEND_BLOCKS, note: 'modifier x base CPC per window; every hour covered so it serves 24/7' },
    headlines: HEADLINES, descriptions: DESCRIPTIONS,
  };
  if (!geo.length) return json(200, { ok: false, error: 'no city geo resolved', suggestions: sugg.slice(0, 6).map((s) => s.geoTargetConstant && s.geoTargetConstant.canonicalName) });
  if (!apply) return json(200, { ok: true, mode: 'preview', cid, plan, note: 'add &apply=1 to create PAUSED, &enable=1 to also turn it on' });

  // budget
  const b = await post('/campaignBudgets:mutate', { operations: [{ create: { name: `${name} budget ${Date.now()}`, amountMicros: budget * 1000000, deliveryMethod: 'STANDARD', explicitlyShared: false } }] });
  if (!b.ok) return json(200, { ok: false, step: 'budget', error: b.err });
  const budgetRes = b.d.results[0].resourceName;

  // campaign — Manual CPC so the ad-schedule bid modifiers fully apply
  const camp = await post('/campaigns:mutate', { operations: [{ create: {
    name, advertisingChannelType: 'SEARCH', status: enable ? 'ENABLED' : 'PAUSED', campaignBudget: budgetRes,
    manualCpc: { enhancedCpcEnabled: false },
    networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
    containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
  } }] });
  if (!camp.ok) return json(200, { ok: false, step: 'campaign', error: camp.err, budget: budgetRes });
  const campRes = camp.d.results[0].resourceName;

  // geo + ad-schedule (dayparting) + negatives — all campaign criteria
  const geoMut = await post('/campaignCriteria:mutate', { operations: geo.map((g) => ({ create: { campaign: campRes, location: { geoTargetConstant: g.resource } } })) });
  const schedMut = await post('/campaignCriteria:mutate', { partialFailure: true, operations: scheduleCriteria(campRes) });
  const negMut = await post('/campaignCriteria:mutate', { partialFailure: true, operations: NEGATIVES.map((t) => ({ create: { campaign: campRes, negative: true, keyword: { text: t, matchType: 'BROAD' } } })) });

  // optional CALL ASSET (the local number on the ad) — create the asset, link it to THIS
  // campaign only. Different regions get different local numbers this way (LA -> 225).
  let callRes = { ok: true, skipped: true };
  if (callNumber) {
    const a = await post('/assets:mutate', { operations: [{ create: { callAsset: { countryCode: 'US', phoneNumber: callNumber, callConversionReportingState: 'USE_ACCOUNT_LEVEL_CALL_CONVERSION_ACTION' } } }] });
    if (a.ok) {
      const assetRes = a.d.results[0].resourceName;
      const link = await post('/campaignAssets:mutate', { operations: [{ create: { campaign: campRes, asset: assetRes, fieldType: 'CALL' } }] });
      callRes = { ok: link.ok, number: callNumber, asset: assetRes, err: link.err };
    } else { callRes = { ok: false, number: callNumber, err: a.err }; }
  }

  // SHELL mode: campaign-level only, no ad group — per-city ad groups get added next via
  // step=city (keeps each call small so nothing times out mid-create). Left PAUSED.
  if (step === 'shell') {
    return json(200, {
      ok: camp.ok, mode: 'shell created (PAUSED)', cid, campaign: campRes, status: 'PAUSED', budget_per_day: budget,
      geo: { ok: geoMut.ok, targeted: geo.map((g) => g.canonical), err: geoMut.err },
      schedule: { ok: schedMut.ok, blocks: scheduleCriteria(campRes).length, err: schedMut.err },
      negatives: { ok: negMut.ok, count: NEGATIVES.length, err: negMut.err },
      call: callRes,
      next: `add each city: ?step=city&apply=1&campaign=${campRes.split('/').pop()}&state=${encodeURIComponent(STATE)}&city=<City>`,
    });
  }

  // FULL mode: single all-appliance ad group + keywords + RSA (TN uses this).
  const ag = await post('/adGroups:mutate', { operations: [{ create: { name: 'After-Hours ad group', campaign: campRes, status: 'ENABLED', type: 'SEARCH_STANDARD', cpcBidMicros: baseCpc * 1000000 } }] });
  if (!ag.ok) return json(200, { ok: false, step: 'adgroup', error: ag.err, campaign: campRes });
  const agRes = ag.d.results[0].resourceName;
  const kw = await post('/adGroupCriteria:mutate', { partialFailure: true, operations: KEYWORDS.map((t) => ({ create: { adGroup: agRes, status: 'ENABLED', keyword: { text: t, matchType: 'PHRASE' } } })) });
  const ad = await post('/adGroupAds:mutate', { operations: [{ create: { adGroup: agRes, status: 'ENABLED', ad: { finalUrls: [finalUrl], responsiveSearchAd: { headlines: HEADLINES.map((t) => ({ text: t })), descriptions: DESCRIPTIONS.map((t) => ({ text: t })) } } } }] });

  return json(200, {
    ok: !!(camp.ok && ag.ok), mode: enable ? 'created+enabled' : 'created (PAUSED)', cid,
    campaign: campRes, status: enable ? 'ENABLED' : 'PAUSED', budget_per_day: budget,
    geo: { ok: geoMut.ok, targeted: geo.map((g) => g.canonical), err: geoMut.err },
    schedule: { ok: schedMut.ok, blocks: scheduleCriteria(campRes).length, err: schedMut.err },
    negatives: { ok: negMut.ok, count: NEGATIVES.length, err: negMut.err },
    call: callRes,
    keywords: { ok: kw.ok, count: KEYWORDS.length, err: kw.err },
    ad: { ok: ad.ok, err: ad.err },
    plan,
  });
};
