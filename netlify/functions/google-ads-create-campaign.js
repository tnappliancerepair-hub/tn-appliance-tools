// google-ads-create-campaign — stand up a full Search campaign from one command:
// budget → campaign → geo targeting → ad group → keywords → responsive search ad.
// This is the "just say it and it runs" builder. Creates PAUSED so we can verify the
// targeting before a dollar is spent; flip live with &enable=1 (or google-ads-enable).
//
//   GET ?secret=&appliance=dryer|refrigerator&cities=Smyrna,Murfreesboro&state=Tennessee&budget=20
//        preview: resolve geo + show the plan, write nothing
//   ...&apply=1            create it all, PAUSED
//   ...&apply=1&enable=1   create it all + turn it ON
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function todayYMD() { const p = {}; for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())) p[x.type] = x.value; return `${p.year}${p.month}${p.day}`; }

// appliance → keywords + ad copy (headlines ≤30 chars, descriptions ≤90).
const KITS = {
  dryer: {
    label: 'Dryer Repair',
    keywords: ['dryer repair', 'dryer repair near me', 'dryer not heating', 'dryer technician', 'dryer repair service', 'fix my dryer', 'appliance repair dryer'],
    headlines: ['Fast Dryer Repair', 'Same-Week Dryer Repair', 'Dryer Not Heating?', 'Local Dryer Repair Pros', '$50 Dryer Quick Check', 'Honest Dryer Repair', 'Book Dryer Repair Today', 'Dryer Fixed Right'],
    descriptions: ['Dryer not heating or spinning? Local techs fix it fast. Book your $50 Quick Check.', 'Honest, upfront pricing. Same-week service in Smyrna & Murfreesboro. Book online now.'],
    final: 'https://tnapplianceexchange.net/appliance-ai.html?appliance=dryer',
  },
  refrigerator: {
    label: 'Refrigerator Repair',
    keywords: ['refrigerator repair', 'refrigerator repair near me', 'fridge not cooling', 'refrigerator technician', 'fridge repair service', 'fix my refrigerator', 'appliance repair refrigerator'],
    headlines: ['Fast Fridge Repair', 'Refrigerator Not Cooling?', 'Same-Week Fridge Repair', 'Local Fridge Repair Pros', '$50 Fridge Quick Check', 'Honest Fridge Repair', 'Book Fridge Repair Today', 'Refrigerator Fixed Right'],
    descriptions: ['Fridge not cooling? Local techs fix it fast. Book your $50 Quick Check today.', 'Honest, upfront pricing. Same-week service in Smyrna & Murfreesboro. Book online now.'],
    final: 'https://tnapplianceexchange.net/appliance-ai.html?appliance=refrigerator',
  },
};

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const appl = String(q.appliance || 'dryer').toLowerCase();
  const kit = KITS[appl];
  if (!kit) return json(400, { ok: false, error: 'appliance must be dryer or refrigerator' });
  const cities = String(q.cities || 'Smyrna,Murfreesboro').split(',').map((s) => s.trim()).filter(Boolean);
  const stateName = String(q.state || 'Tennessee').trim();
  const budget = Math.max(5, Math.min(500, parseInt(q.budget, 10) || 20));
  const apply = q.apply === '1';
  const enable = q.enable === '1';

  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false });
  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const base = `https://googleads.googleapis.com/${c.version}/customers/${cid}`;

  // POST helper with manager-login fallback on 403.
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

  // 1) resolve geo target constants for the cities (City type, in the state)
  const geoUrl = `https://googleads.googleapis.com/${c.version}/geoTargetConstants:suggest`;
  let geoResp;
  try { const gr = await fetch(geoUrl, { method: 'POST', headers: ads.apiHeaders(token, c), body: JSON.stringify({ locale: 'en', countryCode: 'US', locationNames: { names: cities.map((x) => `${x}, ${stateName}`) } }) }); geoResp = await gr.json().catch(() => ({})); }
  catch (e) { return json(200, { ok: false, step: 'geo', error: String(e.message || e) }); }
  const sugg = (geoResp.geoTargetConstantSuggestions || []);
  const geo = [];
  for (const city of cities) {
    const want = `${city.toLowerCase()},${stateName.toLowerCase()}`;
    const m = sugg.find((s) => s.geoTargetConstant && String(s.geoTargetConstant.canonicalName || '').toLowerCase().replace(/\s/g, '').includes(want.replace(/\s/g, '')) && (s.geoTargetConstant.targetType === 'City'))
      || sugg.find((s) => s.geoTargetConstant && String(s.geoTargetConstant.name || '').toLowerCase() === city.toLowerCase());
    if (m) geo.push({ city, resource: m.geoTargetConstant.resourceName, canonical: m.geoTargetConstant.canonicalName });
  }
  const name = `${kit.label} — ${cities.join('/')} (Ant)`;
  const planView = { campaign: name, appliance: appl, cities, geo_resolved: geo.map((g) => g.canonical), budget_per_day: budget, keywords: kit.keywords, headlines: kit.headlines, final_url: kit.final, status: enable ? 'ENABLED' : 'PAUSED' };
  if (!geo.length) return json(200, { ok: false, error: 'could not resolve any city geo targets', suggestions: sugg.slice(0, 6).map((s) => s.geoTargetConstant && s.geoTargetConstant.canonicalName) });
  if (!apply) return json(200, { ok: true, mode: 'preview', cid, plan: planView, note: 'add &apply=1 to create (PAUSED), &enable=1 to also turn it on' });

  // 2) budget
  const b = await post('/campaignBudgets:mutate', { operations: [{ create: { name: `${name} budget ${Date.now()}`, amountMicros: budget * 1000000, deliveryMethod: 'STANDARD', explicitlyShared: false } }] });
  if (!b.ok) return json(200, { ok: false, step: 'budget', error: b.err });
  const budgetRes = b.d.results[0].resourceName;

  // 3) campaign (manual CPC so a cold-start test reliably serves; PAUSED unless enable)
  const camp = await post('/campaigns:mutate', { operations: [{ create: {
    name, advertisingChannelType: 'SEARCH', status: enable ? 'ENABLED' : 'PAUSED', campaignBudget: budgetRes,
    targetSpend: {}, networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
    containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
    startDate: todayYMD(),
  } }] });
  if (!camp.ok) return json(200, { ok: false, step: 'campaign', error: camp.err, budget: budgetRes });
  const campRes = camp.d.results[0].resourceName;

  // 4) geo targeting
  const geoMut = await post('/campaignCriteria:mutate', { operations: geo.map((g) => ({ create: { campaign: campRes, location: { geoTargetConstant: g.resource } } })) });

  // 5) ad group (default max CPC $6 — aggressive enough to win a small market, capped)
  const ag = await post('/adGroups:mutate', { operations: [{ create: { name: `${kit.label} ad group`, campaign: campRes, status: 'ENABLED', type: 'SEARCH_STANDARD', cpcBidMicros: 6000000 } }] });
  if (!ag.ok) return json(200, { ok: false, step: 'adgroup', error: ag.err, campaign: campRes });
  const agRes = ag.d.results[0].resourceName;

  // 6) keywords (phrase match)
  const kw = await post('/adGroupCriteria:mutate', { partialFailure: true, operations: kit.keywords.map((t) => ({ create: { adGroup: agRes, status: 'ENABLED', keyword: { text: t, matchType: 'PHRASE' } } })) });

  // 7) responsive search ad
  const ad = await post('/adGroupAds:mutate', { operations: [{ create: { adGroup: agRes, status: 'ENABLED', ad: { finalUrls: [kit.final], responsiveSearchAd: { headlines: kit.headlines.map((t) => ({ text: t })), descriptions: kit.descriptions.map((t) => ({ text: t })) } } } }] });

  return json(200, {
    ok: !!(camp.ok && ag.ok), mode: enable ? 'created+enabled' : 'created (paused)', cid,
    campaign: campRes, status: enable ? 'ENABLED' : 'PAUSED', budget_per_day: budget,
    geo: { ok: geoMut.ok, targeted: geo.map((g) => g.canonical), err: geoMut.err },
    keywords: { ok: kw.ok, count: kit.keywords.length, err: kw.err },
    ad: { ok: ad.ok, err: ad.err },
    plan: planView,
  });
};
