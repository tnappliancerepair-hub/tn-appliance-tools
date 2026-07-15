// gsc-trend — "how have we improved?" Period-over-period Search Console comparison: the
// last N days vs the N days before that. Shows the movement in clicks, impressions, average
// position, and ranked pages/queries, plus the biggest query MOVERS (rank gains), the top
// impression gains, and brand-new queries we started showing for. Owner-gated.
//
//   GET ?secret=<admin>[&days=28]
'use strict';
const gsc = require('./_lib/search-console');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const key = (r) => (r.keys && r.keys[0]) || '';
function totals(rows) {
  let clicks = 0, impr = 0, posw = 0;
  for (const r of rows) { clicks += r.clicks || 0; impr += r.impressions || 0; posw += (r.position || 0) * (r.impressions || 0); }
  return { clicks, impressions: impr, avg_position: impr ? Math.round((posw / impr) * 10) / 10 : 0, count: rows.length };
}
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0));

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const days = Math.max(7, Math.min(90, parseInt(q.days, 10) || 28));

  try {
    const [curQ, prevQ, curP, prevP] = await Promise.all([
      gsc.query({ days, dimensions: ['query'], rowLimit: 2000 }),
      gsc.query({ days, endDaysAgo: days, dimensions: ['query'], rowLimit: 2000 }),
      gsc.query({ days, dimensions: ['page'], rowLimit: 5000 }),
      gsc.query({ days, endDaysAgo: days, dimensions: ['page'], rowLimit: 5000 }),
    ]);
    if (!curQ.ok) return json(200, { ok: false, error: curQ.error || 'gsc query failed', missing: curQ.missing });

    const curRows = curQ.rows || [], prevRows = prevQ.rows || [];
    const tc = totals(curRows), tp = totals(prevRows);
    const rankedPagesCur = (curP.rows || []).filter((r) => (r.impressions || 0) > 0).length;
    const rankedPagesPrev = (prevP.rows || []).filter((r) => (r.impressions || 0) > 0).length;

    // join queries
    const prevBy = {}; prevRows.forEach((r) => { prevBy[key(r)] = r; });
    const curBy = {}; curRows.forEach((r) => { curBy[key(r)] = r; });

    // biggest rank IMPROVEMENTS (moved up toward 1), min impressions to cut noise
    const movers = curRows.filter((r) => prevBy[key(r)] && (r.impressions >= 8 || prevBy[key(r)].impressions >= 8))
      .map((r) => { const p = prevBy[key(r)]; return { query: key(r), pos_now: r.position, pos_before: p.position, pos_gain: Math.round((p.position - r.position) * 10) / 10, impr_now: r.impressions, impr_before: p.impressions }; })
      .filter((m) => m.pos_gain !== 0)
      .sort((a, b) => b.pos_gain - a.pos_gain);

    // biggest impression gains
    const imprGains = curRows.filter((r) => prevBy[key(r)]).map((r) => ({ query: key(r), impr_now: r.impressions, impr_before: prevBy[key(r)].impressions, gain: r.impressions - prevBy[key(r)].impressions, pos_now: r.position })).filter((x) => x.gain > 0).sort((a, b) => b.gain - a.gain);

    // brand-new queries (showing now, not before) with real volume
    const newQ = curRows.filter((r) => !prevBy[key(r)] && r.impressions >= 5).map((r) => ({ query: key(r), impressions: r.impressions, position: r.position, clicks: r.clicks })).sort((a, b) => b.impressions - a.impressions);

    return json(200, {
      ok: true, site: curQ.site, window_days: days,
      current_period: tc, prior_period: tp,
      change: {
        clicks: tc.clicks - tp.clicks, clicks_pct: pct(tc.clicks, tp.clicks),
        impressions: tc.impressions - tp.impressions, impressions_pct: pct(tc.impressions, tp.impressions),
        avg_position_delta: Math.round((tp.avg_position - tc.avg_position) * 10) / 10, // + = improved (lower pos number)
        ranking_queries: tc.count - tp.count,
        ranked_pages: rankedPagesCur - rankedPagesPrev, ranked_pages_now: rankedPagesCur, ranked_pages_before: rankedPagesPrev,
      },
      top_rank_gains: movers.slice(0, 15),
      top_impression_gains: imprGains.slice(0, 12),
      new_queries: newQ.slice(0, 15),
      biggest_drops: movers.slice(-8).reverse(),
    });
  } catch (err) { return json(200, { ok: false, error: err.message }); }
};
