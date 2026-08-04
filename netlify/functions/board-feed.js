// board-feed — a cached shared proxy in front of get_office_kanban.
//
// WHY: get_office_kanban loads ~700 jobs with a 7-status OR query and runs
// 9-24s. The board polls it every 30s, and with several office users each
// polling, Xano's compute saturates — which is what makes WRITES (tech saves,
// office saves) time out and silently vanish. This proxy makes every office
// user share ONE cached copy at Netlify's edge (s-maxage), so Xano runs the
// heavy query ~once per 25s TOTAL instead of once per user per 30s. stale-
// while-revalidate serves the last-good feed instantly while a fresh one is
// fetched in the background, so the board never waits on the slow query.
//
// On upstream error/timeout we return a non-cacheable 502 so the CDN keeps
// serving the last good cached copy (and the board keeps its own client cache).
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

exports.config = { timeout: 26 };

exports.handler = async function () {
  try {
    const r = await fetch(`${XANO}/get_office_kanban`, { signal: AbortSignal.timeout(24000) });
    const text = await r.text();
    // Only cache a genuinely good feed (200 + has items). Anything else is
    // returned non-cacheable so the edge keeps the last good copy.
    let good = false;
    if (r.ok) { try { const d = JSON.parse(text); good = Array.isArray(d.items) && d.items.length > 0; } catch (_) {} }
    if (good) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          // Edge-cache, shared across all office users; serve stale instantly.
          // s-maxage=45 = Xano runs the heavy 688-row query ~once per 45s TOTAL
          // (not per-user-per-30s), leaving compute headroom so SAVES don't time out.
          // stale-while-revalidate serves the last-good feed instantly meanwhile.
          'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=45, stale-while-revalidate=300',
          'Cache-Control': 'public, max-age=0, must-revalidate', // browser revalidates; edge serves the cache
        },
        body: text,
      };
    }
    return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: false, error: 'upstream_bad', status: r.status }) };
  } catch (e) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: false, error: 'upstream_timeout' }) };
  }
};
