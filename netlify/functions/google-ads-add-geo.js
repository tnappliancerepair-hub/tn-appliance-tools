// google-ads-add-geo — add cities to the geo targeting of the live campaigns.
// Teddy 7/5: "add La Vergne + Antioch to your geo so you actually show where you
// live." The two campaigns launched targeting Smyrna/Murfreesboro only, so the
// ad never served in La Vergne (his home turf) — this widens the net to the
// zips where the crew actually lives.
//
//   GET ?secret=                              preview: resolve the geo, write nothing
//   ...&apply=1                               add the cities to BOTH campaigns
//   ...&cities=La Vergne,Antioch&state=Tennessee   (defaults shown)
//   ...&campaigns=23985730202,23990301052          (defaults = Dryer + Refrigerator)
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const cities = String(q.cities || 'La Vergne,Antioch').split(',').map((s) => s.trim()).filter(Boolean);
  const stateName = String(q.state || 'Tennessee').trim();
  const campaignIds = String(q.campaigns || '23985730202,23990301052').split(',').map((s) => s.trim()).filter(Boolean);
  const apply = q.apply === '1';

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

  // 1) resolve geo target constants (City type, in the state)
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
  if (!geo.length) return json(200, { ok: false, error: 'could not resolve any city geo targets', suggestions: sugg.slice(0, 8).map((s) => s.geoTargetConstant && s.geoTargetConstant.canonicalName) });

  if (!apply) return json(200, { ok: true, mode: 'preview', cid, campaigns: campaignIds, geo_resolved: geo.map((g) => g.canonical), note: 'add &apply=1 to add these cities to every listed campaign' });

  // 2) add each resolved city to each campaign's criteria.
  const results = [];
  for (const campId of campaignIds) {
    const campRes = `customers/${cid}/campaigns/${campId}`;
    const mut = await post('/campaignCriteria:mutate', { partialFailure: true, operations: geo.map((g) => ({ create: { campaign: campRes, location: { geoTargetConstant: g.resource } } })) });
    results.push({ campaign: campId, ok: mut.ok, added: mut.ok ? geo.map((g) => g.canonical) : [], err: mut.err });
  }

  return json(200, { ok: results.every((r) => r.ok), cid, cities: geo.map((g) => g.canonical), results });
};
