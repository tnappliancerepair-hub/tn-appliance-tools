// gsc-triage — the SEO portfolio triage (read-only, no changes to any page).
// Cross-references every sitemap URL against 90-day Search Console page data and
// buckets each one so we know what to UPGRADE, what to leave alone, and what to
// PRUNE/noindex.
//
// AGE-AWARE (Teddy 2026-08-18): "0 impressions in 90 days" is meaningless for a page
// that has only existed a couple weeks — new pages sit at zero for weeks-to-months
// while Google crawls -> indexes -> starts ranking. Pruning a newborn is premature AND
// add-then-remove churn erodes domain trust. So a 0-impression English page is only
// called PRUNE once it is at least min_age_days old (default 45). Younger ones go to
// too_young (held) and prune_unknown_age holds any page with no <lastmod> to age it by.
//
//   GET ?secret=<admin>[&days=90][&min_age_days=45][&full=1]
//     winners           = impressions AND avg position < 4.5 (already strong)
//     upgrade           = impressions AND position 4.5-20 (striking distance — deepen FIRST)
//     emerging          = impressions but buried (position > 20)
//     lang_wait         = a /es|vi|fr|ar|hi|zh|ru/ page with 0 impressions (its own decision)
//     too_young         = English, 0 impressions, younger than min_age_days — give it time
//     prune             = English, 0 impressions, min_age_days+ old — had a fair shot, dead
//     prune_unknown_age = English, 0 impressions, no <lastmod> to age it by — held, not pruned
'use strict';
const sc = require('./_lib/search-console');
const { getSecret } = require('./_lib/secrets');
const SITE = 'https://tnapplianceexchange.net';
const LANG_RE = /\/(es|vi|fr|ar|hi|zh|ru)\//;
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function norm(u) { return String(u || '').replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '') || '/'; }

// Parse <url> blocks so we capture <lastmod> alongside each <loc> (the age signal).
async function fetchSitemap() {
  const out = [];
  try {
    const r = await fetch(SITE + '/sitemap.xml', { signal: AbortSignal.timeout(15000) });
    const xml = await r.text();
    for (const block of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
      const seg = block[1];
      const loc = (seg.match(/<loc>([^<]+)<\/loc>/i) || [])[1];
      if (!loc) continue;
      const lastmod = (seg.match(/<lastmod>([^<]+)<\/lastmod>/i) || [])[1] || '';
      out.push({ loc: loc.trim(), lastmod: lastmod.trim() });
    }
    // Fallback: a sitemap without <url> wrappers (or an index) — grab bare locs, no age.
    if (!out.length) for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) out.push({ loc: m[1].trim(), lastmod: '' });
  } catch (_) {}
  return out;
}
// Days since a page's <lastmod>. null when we can't tell (missing/invalid) — never guess.
function ageDays(lastmod, nowMs) {
  if (!lastmod) return null;
  const t = Date.parse(lastmod);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 86400000));
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
  // How old a 0-impression page must be before we're willing to call it dead.
  const minAge = Math.max(7, Math.min(180, parseInt(q.min_age_days, 10) || 45));
  const nowMs = Date.now();

  let res;
  try { res = await sc.query({ days, dimensions: ['page'], rowLimit: 5000 }); }
  catch (e) { return json(200, { ok: false, error: 'gsc query failed: ' + String((e && e.message) || e) }); }
  const impr = {};
  for (const r of (res.rows || [])) {
    impr[norm(r.keys && r.keys[0])] = { impr: r.impressions || 0, clicks: r.clicks || 0, pos: Math.round((r.position || 0) * 10) / 10 };
  }

  const sm = await fetchSitemap();
  const seen = new Set();
  const B = { winners: [], upgrade: [], emerging: [], lang_wait: [], too_young: [], prune: [], prune_unknown_age: [] };
  let withLastmod = 0;
  for (const item of sm) {
    const p = norm(item.loc);
    if (seen.has(p)) continue; seen.add(p);
    const age = ageDays(item.lastmod, nowMs);
    if (age !== null) withLastmod++;
    const m = impr[p];
    if (m && m.impr > 0) {
      const row = { url: p, impr: m.impr, clicks: m.clicks, pos: m.pos, age_days: age };
      if (m.pos < 4.5) B.winners.push(row);
      else if (m.pos <= 20) B.upgrade.push(row);
      else B.emerging.push(row);
    } else if (LANG_RE.test(p)) {
      B.lang_wait.push({ url: p, age_days: age });
    } else if (age === null) {
      B.prune_unknown_age.push({ url: p, age_days: null });
    } else if (age < minAge) {
      B.too_young.push({ url: p, age_days: age });
    } else {
      B.prune.push({ url: p, age_days: age });
    }
  }
  B.winners.sort((a, b) => b.impr - a.impr);
  B.upgrade.sort((a, b) => (a.pos - b.pos) || (b.impr - a.impr));
  B.emerging.sort((a, b) => b.impr - a.impr);
  B.too_young.sort((a, b) => (a.age_days || 0) - (b.age_days || 0));
  B.prune.sort((a, b) => (b.age_days || 0) - (a.age_days || 0));

  // Age distribution of every English 0-impression page (too_young + prune) so the
  // newborn-vs-dead split is visible at a glance.
  const dist = { '<14d': 0, '14-30d': 0, '30-45d': 0, '45-90d': 0, '90d+': 0 };
  for (const it of [...B.too_young, ...B.prune]) {
    const a = it.age_days;
    if (a < 14) dist['<14d']++; else if (a < 30) dist['14-30d']++; else if (a < 45) dist['30-45d']++; else if (a < 90) dist['45-90d']++; else dist['90d+']++;
  }

  // summarize the (genuinely-aged) prune set by URL template
  const byTemplate = {};
  for (const it of B.prune) { const t = template(it.url); byTemplate[t] = (byTemplate[t] || 0) + 1; }
  const prune_patterns = Object.entries(byTemplate).map(([t, n]) => ({ pattern: t, count: n })).sort((a, b) => b.count - a.count).slice(0, 25);

  return json(200, {
    ok: true, days, min_age_days: minAge,
    sitemap_urls: seen.size, sitemap_with_lastmod: withLastmod, pages_with_impressions: Object.keys(impr).length,
    counts: {
      winners: B.winners.length, upgrade: B.upgrade.length, emerging: B.emerging.length,
      lang_wait: B.lang_wait.length, too_young: B.too_young.length, prune: B.prune.length,
      prune_unknown_age: B.prune_unknown_age.length,
    },
    zero_impression_english_age_dist: dist,
    age_note:
      'prune = English pages, 0 impressions, ' + minAge + 'd+ old (had a fair shot — genuinely dead). ' +
      'too_young = 0-impression English pages younger than ' + minAge + 'd, HELD out of prune (new pages sit at 0 for weeks; killing them now is premature + add/remove churn erodes trust). ' +
      'prune_unknown_age = no <lastmod> in the sitemap so we can\'t age it — also held. ' +
      'Bump ?min_age_days= to be more patient. sitemap_with_lastmod shows how many URLs carry a date to judge by.',
    upgrade_first: B.upgrade.slice(0, 30),
    top_winners: B.winners.slice(0, 20),
    prune_patterns,
    too_young_sample: B.too_young.slice(0, 25),
    prune_urls: q.full === '1' ? B.prune : B.prune.slice(0, 60),
  });
};
