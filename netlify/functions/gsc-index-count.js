// gsc-index-count — "how many of our pages are actually indexed?" Pulls it three
// ways from Search Console (read-only, creds already vaulted):
//   1) ranked_pages_90d  — distinct pages that got ≥1 impression in 90 days.
//      A hard floor of pages Google has indexed AND shown (can't show what it
//      hasn't indexed). Best live proxy without inspecting every URL.
//   2) sitemap_submitted — URLs we've submitted (from the Sitemaps API).
//   3) sitemap_indexed   — Google's own indexed count per sitemap, if it still
//      populates the field (it's been deprecating it in the UI).
//
//   GET ?secret=<admin>[&days=90]
'use strict';
const { getSecret } = require('./_lib/secrets');
const gsc = require('./_lib/search-console');
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return j(401, { ok: false, error: 'unauthorized — ?secret=' });
  const days = Math.max(7, Math.min(480, parseInt(q.days, 10) || 90));

  const c = await gsc.creds();
  if (!c.clientId || !c.refresh) return j(200, { ok: false, configured: false, note: 'GSC not connected — vault GSC_REFRESH_TOKEN' });

  // 1) distinct pages with impressions (indexed-and-shown floor)
  let rankedPages = null, sample = [];
  try {
    const r = await gsc.query({ days, dimensions: ['page'], rowLimit: 5000 });
    if (r.ok) { rankedPages = (r.rows || []).length; sample = (r.rows || []).slice(0, 5).map((x) => (x.keys && x.keys[0]) || ''); }
  } catch (_) {}

  // 2)+3) sitemaps: submitted + (maybe) indexed, straight from the Sitemaps API
  let submitted = 0, indexed = 0, sitemaps = [], sawIndexed = false;
  try {
    const token = await gsc.accessToken(c);
    const base = 'https://searchconsole.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(c.siteUrl) + '/sitemaps';
    const list = await fetch(base, { headers: { Authorization: 'Bearer ' + token } }).then((r) => r.json()).catch(() => ({}));
    for (const sm of (list.sitemap || [])) {
      let sub = 0, idx = 0;
      for (const con of (sm.contents || [])) { sub += Number(con.submitted || 0); if (con.indexed != null) { idx += Number(con.indexed || 0); sawIndexed = true; } }
      submitted += sub; indexed += idx;
      sitemaps.push({ path: sm.path, submitted: sub, indexed: idx || null, last_downloaded: sm.lastDownloaded || null, errors: sm.errors || 0, warnings: sm.warnings || 0 });
    }
  } catch (_) {}

  return j(200, {
    ok: true, site: c.siteUrl, window_days: days,
    ranked_pages_90d: rankedPages,
    sitemap_submitted: submitted || null,
    sitemap_indexed: sawIndexed ? indexed : null,
    sitemaps,
    sample_ranked_pages: sample,
    how_to_read: 'ranked_pages_90d = pages Google indexed AND showed in the last ' + days + ' days (a floor). sitemap_indexed = Google\'s own count if it still reports it. The exact "indexed vs not" lives in Search Console → Indexing → Pages.',
  });
};
