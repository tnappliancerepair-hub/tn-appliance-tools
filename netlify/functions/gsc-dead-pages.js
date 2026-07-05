// gsc-dead-pages — the indexing hit-list. Cross-references the sitemap against
// what Search Console actually shows, so we can SEE the dead weight: pages we
// submitted that got zero impressions in 90 days (almost certainly "discovered,
// not indexed" — the thin doorway landers). More pages ≠ more indexed; pruning
// the dead pile raises the site's quality signal + frees crawl budget for the
// pages that matter.
//
//   GET ?secret=<admin>[&days=90]
//     -> { ok, sitemap, shown, dead, dead_by_pattern, dead_sample }
'use strict';
const { getSecret } = require('./_lib/secrets');
const gsc = require('./_lib/search-console');
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function norm(u) { return String(u || '').replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase(); }
// bucket a URL by its shape so the doorway clusters are obvious
function pattern(path) {
  const p = path.replace(/^https?:\/\/[^/]+/, '') || '/';
  if (p === '/' || p === '') return '(home)';
  const seg = p.split('/').filter(Boolean);
  const last = seg[seg.length - 1] || '';
  if (/appliance-repair/.test(last) && /-(tn|la| tennessee|louisiana)?/.test(last)) return 'city "*-appliance-repair*" lander';
  if (/dryer-vent/.test(last)) return 'dryer-vent lander';
  if (seg.length >= 2) return '/' + seg[0] + '/*';
  return '/' + (last.split('-').slice(-1)[0] || 'page');
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return j(401, { ok: false, error: 'unauthorized — ?secret=' });
  const days = Math.max(28, Math.min(480, parseInt(q.days, 10) || 90));

  // 1) sitemap URLs
  let sitemapUrls = [];
  try {
    const xml = await fetch('https://tnapplianceexchange.net/sitemap.xml', { signal: AbortSignal.timeout(15000) }).then((r) => r.text());
    sitemapUrls = (xml.match(/<loc>([^<]+)<\/loc>/g) || []).map((m) => m.replace(/<\/?loc>/g, '').trim());
  } catch (e) { return j(200, { ok: false, step: 'sitemap', error: String(e.message || e) }); }
  const sitemapSet = new Set(sitemapUrls.map(norm));

  // 2) pages GSC actually shows (indexed-and-ranked floor)
  let shown = new Set();
  try {
    const r = await gsc.query({ days, dimensions: ['page'], rowLimit: 5000 });
    if (r.ok) for (const row of (r.rows || [])) { const u = (row.keys && row.keys[0]) || ''; if (u) shown.add(norm(u)); }
  } catch (_) {}

  // 3) dead = in sitemap, never shown
  const dead = [];
  for (const u of sitemapUrls) if (!shown.has(norm(u))) dead.push(u);

  // 4) cluster the dead by pattern so the doorway pile is obvious
  const byPat = {};
  for (const u of dead) { const p = pattern(u); byPat[p] = (byPat[p] || 0) + 1; }
  const deadByPattern = Object.entries(byPat).sort((a, b) => b[1] - a[1]).map(([pat, n]) => ({ pattern: pat, dead: n }));

  return j(200, {
    ok: true, window_days: days,
    sitemap: sitemapUrls.length,
    shown_indexed_floor: shown.size,
    dead: dead.length,
    dead_pct: sitemapUrls.length ? Math.round((dead.length / sitemapUrls.length) * 100) : 0,
    dead_by_pattern: deadByPattern.slice(0, 15),
    dead_sample: dead.slice(0, 20),
    how_to_read: 'dead = submitted in the sitemap but 0 impressions in ' + days + ' days = almost certainly not indexed. Prune/consolidate the biggest dead clusters; keep + strengthen the shown pages.',
  });
};
