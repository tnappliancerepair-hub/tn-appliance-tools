// gsc-queries — owner-gated organic SEO scoreboard. Shows what the site ranks for
// and, more usefully, the STRIKING-DISTANCE queries (position ~5-20): the ones a
// little on-page work can lift onto page 1 — the cheapest SEO wins. Filters a
// dryer view too, since that's the paid focus.
//   GET ?secret=<admin>[&days=28][&q=dryer]
'use strict';
const { getSecret } = require('./_lib/secrets');
const gsc = require('./_lib/search-console');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const p = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (p.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const days = Math.max(1, Math.min(90, parseInt(p.days, 10) || 28));
  const filter = (p.q || '').toLowerCase().trim();

  let res;
  try { res = await gsc.query({ days, dimensions: ['query'], rowLimit: 500 }); }
  catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
  if (!res.ok) return json(200, res);

  let rows = res.rows;
  if (filter) rows = rows.filter((r) => (r.keys[0] || '').toLowerCase().includes(filter));

  // striking distance: real impressions but stuck just off page 1 (pos 5-20).
  const striking = rows
    .filter((r) => r.position >= 4.5 && r.position <= 20 && r.impressions >= 10)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 40)
    .map((r) => ({ query: r.keys[0], position: r.position, impressions: r.impressions, clicks: r.clicks, ctr: r.ctr }));

  const top = [...rows].sort((a, b) => b.clicks - a.clicks).slice(0, 30)
    .map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position, ctr: r.ctr }));

  return json(200, {
    ok: true, site: res.site, days, total_queries: rows.length,
    note: 'striking_distance = position 4.5-20 with impressions — the cheapest page-1 wins. Optimize the page that ranks for these.',
    striking_distance: striking,
    top_by_clicks: top,
  });
};
