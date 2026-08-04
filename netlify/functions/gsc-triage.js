// gsc-triage — the SEO portfolio triage (read-only, no changes to any page).
// Cross-references every sitemap URL against 90-day Search Console page data and
// buckets each one so we know what to UPGRADE, what to leave alone, and what to
// PRUNE/noindex. Language pages are never put in the prune bucket (still new).
//
//   GET ?secret=<admin>[&days=90][&full=1]
//     winners   = impressions AND avg position < 4.5 (already strong)
//     upgrade   = impressions AND position 4.5-20 (striking distance — deepen these FIRST)
//     emerging  = impressions but buried (position > 20)
//     lang_wait = a /es|vi|fr|ar|hi|zh|ru/ page with 0 impressions (new — give it time)
//     prune     = English page, 0 impressions in 90d (noindex / merge / drop)
'use strict';
const sc = require('./_lib/search-console');
const { getSecret } = require('./_lib/secrets');
const SITE = 'https://tnapplianceexchange.net';
const LANG_RE = /\/(es|vi|fr|ar|hi|zh|ru)\//;
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function norm(u) { return String(u || '').replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '') || '/'; }

async function fetchSitemap() {
  const out = [];
  try {
    const r = await fetch(SITE + '/sitemap.xml', { signal: AbortSignal.timeout(15000) });
    const xml = await r.text();
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) out.push(m[1].trim());
  } catch (_) {}
  return out;
}
// crude template so we can summarize the prune set by shape
function template(path) {
  return path
    .replace(/\.html$/, '')
    .replace(/\b(tn|la)\b/g, '{st}')
    .replace(/\d+/g, '{n}')
    .split('/').map((seg) => seg.split('-').map((w) => (w.length > 2 && /^[a-z]+$/.test(w) ? '{w}' : w)).join('-')).join('/');
}

exports.config = { timeout: 26 };
exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const days = Math.max(28, Math.min(180, parseInt(q.days, 10) || 90));

  let res;
  try { res = await sc.query({ days, dimensions: ['page'], rowLimit: 5000 }); }
  catch (e) { return json(200, { ok: false, error: 'gsc query failed: ' + String((e && e.message) || e) }); }
  const impr = {};
  for (const r of (res.rows || [])) {
    impr[norm(r.keys && r.keys[0])] = { impr: r.impressions || 0, clicks: r.clicks || 0, pos: Math.round((r.position || 0) * 10) / 10 };
  }

  const sm = await fetchSitemap();
  const seen = new Set();
  const B = { winners: [], upgrade: [], emerging: [], lang_wait: [], prune: [] };
  for (const raw of sm) {
    const p = norm(raw);
    if (seen.has(p)) continue; seen.add(p);
    const m = impr[p];
    if (m && m.impr > 0) {
      const row = { url: p, impr: m.impr, clicks: m.clicks, pos: m.pos };
      if (m.pos < 4.5) B.winners.push(row);
      else if (m.pos <= 20) B.upgrade.push(row);
      else B.emerging.push(row);
    } else if (LANG_RE.test(p)) {
      B.lang_wait.push(p);
    } else {
      B.prune.push(p);
    }
  }
  B.winners.sort((a, b) => b.impr - a.impr);
  B.upgrade.sort((a, b) => (a.pos - b.pos) || (b.impr - a.impr));
  B.emerging.sort((a, b) => b.impr - a.impr);

  // summarize the prune set by URL template
  const byTemplate = {};
  for (const p of B.prune) { const t = template(p); byTemplate[t] = (byTemplate[t] || 0) + 1; }
  const prune_patterns = Object.entries(byTemplate).map(([t, n]) => ({ pattern: t, count: n })).sort((a, b) => b.count - a.count).slice(0, 25);

  return json(200, {
    ok: true, days, sitemap_urls: seen.size, pages_with_impressions: Object.keys(impr).length,
    counts: { winners: B.winners.length, upgrade: B.upgrade.length, emerging: B.emerging.length, lang_wait: B.lang_wait.length, prune: B.prune.length },
    upgrade_first: B.upgrade.slice(0, 30),
    top_winners: B.winners.slice(0, 20),
    prune_patterns,
    prune_urls: q.full === '1' ? B.prune : B.prune.slice(0, 60),
  });
};
