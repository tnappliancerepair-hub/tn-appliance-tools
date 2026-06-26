// google-ads-performance — pulls real campaign performance (cost, clicks, conv,
// cost-per-conversion) for the last N days from each accessible non-manager Ads
// account, so we can see if the $500/mo is buying jobs or burning. If the dev
// token is still test-only (Basic Access pending), the search call errors — and
// the error tells us that's the remaining gate.
//   GET ?secret=<admin>[&days=30][&cid=8532272803]
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

  // which accounts to query
  let cids = [];
  if (q.cid) cids = [String(q.cid).replace(/\D/g, '')];
  else {
    try {
      const r = await fetch(`https://googleads.googleapis.com/${ver}/customers:listAccessibleCustomers`, { headers: ads.apiHeaders(token, c) });
      const d = await r.json().catch(() => ({}));
      cids = (d.resourceNames || []).map((n) => n.split('/')[1]).filter((id) => id !== c.managerId);
    } catch (_) {}
  }
  if (!cids.length) return json(200, { ok: false, error: 'no client accounts found' });

  const gaql = `SELECT campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.average_cpc FROM campaign WHERE segments.date DURING LAST_${days}_DAYS ORDER BY metrics.cost_micros DESC`;

  const out = [];
  for (const cid of cids) {
    const url = `https://googleads.googleapis.com/${ver}/customers/${cid}/googleAds:search`;
    let r, d;
    // try as direct account (login-cid = the account itself); if that fails, retry via manager
    try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify({ query: gaql }) }); d = await r.json().catch(() => ({})); }
    catch (e) { out.push({ cid, error: String(e.message || e) }); continue; }
    if (!r.ok && r.status === 403 && c.managerId) {
      try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify({ query: gaql }) }); d = await r.json().catch(() => ({})); } catch (_) {}
    }
    if (!r.ok) { out.push({ cid, http: r.status, error: (d.error && (d.error.message || d.error.status)) || d, detail: (d.error && d.error.details && d.error.details[0] && d.error.details[0].errors) || null }); continue; }
    const rows = (d.results || []).map((x) => ({
      campaign: x.campaign && x.campaign.name, status: x.campaign && x.campaign.status,
      cost: x.metrics ? Math.round((Number(x.metrics.costMicros || 0) / 1e6) * 100) / 100 : 0,
      clicks: x.metrics ? Number(x.metrics.clicks || 0) : 0,
      impressions: x.metrics ? Number(x.metrics.impressions || 0) : 0,
      conversions: x.metrics ? Number(x.metrics.conversions || 0) : 0,
      avg_cpc: x.metrics ? Math.round((Number(x.metrics.averageCpc || 0) / 1e6) * 100) / 100 : 0,
    }));
    const totCost = rows.reduce((a, b) => a + b.cost, 0);
    const totConv = rows.reduce((a, b) => a + b.conversions, 0);
    out.push({ cid, days, campaigns: rows.length, total_cost: Math.round(totCost * 100) / 100, total_clicks: rows.reduce((a, b) => a + b.clicks, 0), total_conversions: Math.round(totConv * 100) / 100, cost_per_conversion: totConv > 0 ? Math.round((totCost / totConv) * 100) / 100 : null, rows });
  }
  return json(200, { ok: true, version: ver, accounts: out });
};
