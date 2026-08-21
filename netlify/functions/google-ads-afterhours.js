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
const DEFAULT_CITIES = ['Nashville', 'Antioch', 'Smyrna', 'Murfreesboro', 'La Vergne', 'Mount Juliet', 'Hendersonville', 'Franklin', 'Brentwood', 'Nolensville'];
const STATE = 'Tennessee';
const FINAL = 'https://tnapplianceexchange.net/appliance-ai.html?utm_source=google_ads&utm_medium=cpc&utm_campaign=afterhours';

// Keywords — all-appliance repair intent + the after-hours goldmine nobody else bids on.
const KEYWORDS = [
  'appliance repair near me', 'appliance repair', 'same day appliance repair',
  'appliance repair open now', '24 hour appliance repair', 'emergency appliance repair', 'appliance repair tonight',
  'dryer repair near me', 'refrigerator repair near me', 'washer repair near me', 'dishwasher repair near me', 'oven repair near me',
  'fridge not cooling', 'dryer not heating',
];
// Campaign negatives — kill parts/used/DIY/hiring + the used-store ghost.
const NEGATIVES = ['used', 'for sale', 'parts', 'diy', 'how to', 'job', 'jobs', 'salary', 'rental', 'scrap', 'haul away', 'who buys', 'sell my', 'donate'];

const HEADLINES = [
  'Appliance Repair Near You', 'Same-Day Appliance Repair', 'We Answer 24/7', "Broken Tonight? We're Open",
  'Fridge, Dryer & Washer Fix', 'Honest Appliance Repair', 'Chat or Text Us Now', 'Local Repair Pros',
  '$50 Quick Check', 'Family Owned Since 2012', 'Fast, Honest, Local', 'Book Your Repair Online',
];
const DESCRIPTIONS = [
  'Appliance broke after hours? Chat now — we book it tonight and fix it fast.',
  'Real local techs, honest upfront pricing. Fridge, dryer, washer, oven, dishwasher.',
  'We answer 24/7 when others are closed. Book your repair online in about a minute.',
  'Same-week service across Middle TN. Licensed, insured, 4.5 stars, 1,000+ reviews.',
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

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const cities = String(q.cities || DEFAULT_CITIES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const budget = Math.max(5, Math.min(500, parseInt(q.budget, 10) || 30));
  const finalUrl = (q.final || '').trim() || FINAL;
  const baseCpc = Math.max(1, Math.min(20, parseInt(q.cpc, 10) || 4)); // $ base max CPC, scaled by the schedule
  const apply = q.apply === '1';
  const enable = q.enable === '1';

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

  const name = `After-Hours Appliance Repair — Nashville Metro (Ant)`;
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

  // ad group + keywords + RSA
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
    keywords: { ok: kw.ok, count: KEYWORDS.length, err: kw.err },
    ad: { ok: ad.ok, err: ad.err },
    plan,
  });
};
