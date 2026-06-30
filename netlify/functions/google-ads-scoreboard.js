// google-ads-scoreboard — the live numbers, per campaign: cost, clicks, impressions,
// conversions (booked/paid), and the number that matters — cost per booked job.
// Read-only. Powers ads-scoreboard.html + the daily digest.
//   GET ?secret=&range=TODAY|LAST_7_DAYS|LAST_14_DAYS|LAST_30_DAYS  (default LAST_7_DAYS)
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
const RANGES = new Set(['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS']);
async function officeOk(pw) { if (!pw) return false; try { const r = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) }); const d = await r.json(); return !!(d && d.success === true); } catch (_) { return false; } }

async function fetchScoreboard(range) {
  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return { ok: false, configured: false };
  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const url = `https://googleads.googleapis.com/${c.version}/customers/${cid}/googleAds:search`;
  const gaql = `SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date DURING ${range} AND campaign.status != 'REMOVED'`;
  async function run(loginCid) { const r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, loginCid), body: JSON.stringify({ query: gaql }) }); return { r, d: await r.json().catch(() => ({})) }; }
  let { r, d } = await run(cid);
  if (!r.ok && r.status === 403 && c.managerId) ({ r, d } = await run(c.managerId));
  if (!r.ok) return { ok: false, error: (d.error && d.error.message) || d };

  const rows = (d.results || []).map((x) => {
    const m = x.metrics || {};
    const cost = (Number(m.costMicros || 0)) / 1e6;
    const conv = Number(m.conversions || 0);
    return {
      campaign: x.campaign.name, status: x.campaign.status,
      cost: Math.round(cost * 100) / 100, clicks: Number(m.clicks || 0), impressions: Number(m.impressions || 0),
      conversions: Math.round(conv * 10) / 10, conv_value: Math.round((Number(m.conversionsValue || 0)) * 100) / 100,
      cost_per_conv: conv > 0 ? Math.round((cost / conv) * 100) / 100 : null,
      avg_cpc: Number(m.clicks || 0) > 0 ? Math.round((cost / Number(m.clicks)) * 100) / 100 : 0,
    };
  }).sort((a, b) => b.cost - a.cost);

  const sum = (k) => rows.reduce((a, x) => a + (x[k] || 0), 0);
  const tCost = Math.round(sum('cost') * 100) / 100, tConv = Math.round(sum('conversions') * 10) / 10;
  return {
    ok: true, range, cid, campaigns: rows,
    totals: { cost: tCost, clicks: sum('clicks'), impressions: sum('impressions'), conversions: tConv, cost_per_conv: tConv > 0 ? Math.round((tCost / tConv) * 100) / 100 : null },
  };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin && !(await officeOk(q.password))) return json(401, { ok: false, error: 'unauthorized' });
  const range = RANGES.has(String(q.range || '').toUpperCase()) ? q.range.toUpperCase() : 'LAST_7_DAYS';
  try { return json(200, await fetchScoreboard(range)); }
  catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }
};

module.exports.fetchScoreboard = fetchScoreboard;
