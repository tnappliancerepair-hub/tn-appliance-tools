// google-ads-search-terms — pulls the actual search queries that triggered our
// ads (the real "what did we pay for?" learning). Tells us whether clicks were
// repair-intent or wasted on used-appliance / buy-intent junk we should negative.
//   GET ?secret=<admin>[&days=30][&cid=9267688121]
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const days = Math.max(1, Math.min(365, parseInt(q.days, 10) || 30));

  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false });
  const token = await ads.accessToken(c);
  const ver = c.version;

  const conv = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const cid = String(q.cid || conv).replace(/\D/g, '');

  const gaql = `SELECT search_term_view.search_term, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE segments.date DURING LAST_${days}_DAYS ORDER BY metrics.clicks DESC, metrics.impressions DESC`;

  const url = `https://googleads.googleapis.com/${ver}/customers/${cid}/googleAds:search`;
  let r, d;
  try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify({ query: gaql }) }); d = await r.json().catch(() => ({})); }
  catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }
  if (!r.ok && r.status === 403 && c.managerId) {
    try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify({ query: gaql }) }); d = await r.json().catch(() => ({})); } catch (_) {}
  }
  if (!r.ok) return json(200, { ok: false, http: r.status, error: (d.error && (d.error.message || d.error.status)) || d });

  const terms = (d.results || []).map((x) => ({
    term: x.searchTermView && x.searchTermView.searchTerm,
    campaign: x.campaign && x.campaign.name,
    impressions: x.metrics ? Number(x.metrics.impressions || 0) : 0,
    clicks: x.metrics ? Number(x.metrics.clicks || 0) : 0,
    cost: x.metrics ? Math.round((Number(x.metrics.costMicros || 0) / 1e6) * 100) / 100 : 0,
    conversions: x.metrics ? Number(x.metrics.conversions || 0) : 0,
  }));
  return json(200, { ok: true, cid, days, count: terms.length, total_cost: Math.round(terms.reduce((a, b) => a + b.cost, 0) * 100) / 100, terms });
};
