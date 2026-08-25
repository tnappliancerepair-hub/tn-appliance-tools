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
    let good = false, body = text;
    if (r.ok) {
      try {
        const d = JSON.parse(text);
        good = Array.isArray(d.items) && d.items.length > 0;
        if (good) {
          // SLIM the payload: the board TILE (cardHtml) never renders these long
          // essay fields — the drawer refetches full detail via get_job_for_dashboard
          // on open. problem_summary alone is ~60% of the feed (~280KB across 800 jobs),
          // so trimming it here roughly HALVES the download + client render with zero
          // visible change. (2026-08-26 — fix for Danielle's "board takes forever".)
          const cut = (s, n) => { s = (s == null ? '' : String(s)); return s.length > n ? s.slice(0, n) + '…' : s; };
          for (const j of d.items) {
            if (!j) continue;
            if (j.problem_summary) j.problem_summary = cut(j.problem_summary, 120);
            if (j.customer_preference_text) j.customer_preference_text = cut(j.customer_preference_text, 160);
          }
          body = JSON.stringify(d);
        }
      } catch (_) {}
    }
    if (good) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          // Edge-cache, shared across all office users; serve stale instantly.
          // s-maxage=75 = Xano runs the heavy ~700-row 7-status-OR query at most ~once
          // per 75s TOTAL (not per-user-per-30s), which is the real relief for write
          // STARVATION (that 24s query saturating compute is what makes tech/office
          // SAVES time out). Raised 45->75 to cut heavy-query executions ~40% more.
          // stale-while-revalidate serves the last-good feed instantly meanwhile, and
          // the board's own optimistic pins + 30s poll keep it feeling live. The deeper
          // query-level fix (indexable status filter) is blocked by XS: "in [...]" isn't
          // proven, so the OR can't become an index-friendly IN — that needs deliberate
          // Mac-side testing, not a blind push. (2026-08-04)
          'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=75, stale-while-revalidate=300',
          'Cache-Control': 'public, max-age=0, must-revalidate', // browser revalidates; edge serves the cache
        },
        body: body,
      };
    }
    return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: false, error: 'upstream_bad', status: r.status }) };
  } catch (e) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: false, error: 'upstream_timeout' }) };
  }
};
