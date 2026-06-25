// site-health-sweep — daily site cleanup/health check (no external API needed).
// Catches dead pages + broken redirects from OUR side — where most new 404s are born.
//   1) walks the sitemap (rotating window each day so it covers everything over ~time)
//      and flags any URL that doesn't return 200
//   2) verifies the key 301 redirects still fire to the right place
// Dedups: only texts Teddy about NEWLY-broken URLs (not the same ones every day).
//
//   scheduled (daily)   run + alert on new breaks
//   GET ?dryrun=1       show results, no state write / no SMS
//   GET ?window=N       how many sitemap URLs to check this run (default 200)
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');

const SITE = 'https://tnapplianceexchange.net';
const OWNER = '+16154855795';
// redirect rules we rely on — confirm they still 301 to the right target
const REDIRECT_CHECKS = [
  ['/about-us/', '/about.html'], ['/locations/', '/service-area.html'],
  ['/nashville-tn-appliance-repair/', '/nashville.html'], ['/mt-juliet-appliance-repair/', '/mt-juliet.html'],
  ['/appliance-repair-in-louisiana-50-video-diagnostic/', '/appliance-ai.html'],
];

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function dayOfYear() { const d = new Date(); return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000); }

async function status(url, redirect) {
  try {
    const r = await fetch(url, { method: 'GET', redirect: redirect ? 'manual' : 'follow', signal: AbortSignal.timeout(9000) });
    return { code: r.status, location: r.headers.get('location') || '' };
  } catch (_) { return { code: 0, location: '' }; }
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dryrun === '1';
  const window = Math.min(parseInt(q.window || '200', 10) || 200, 400);
  const start = Date.now(); const BUDGET = 22000;

  // 1) sitemap → rotating window of URLs to check this run
  let urls = [];
  try {
    const xml = await fetch(`${SITE}/sitemap.xml`, { signal: AbortSignal.timeout(12000) }).then((r) => r.text());
    urls = (xml.match(/<loc>([^<]+)<\/loc>/gi) || []).map((m) => m.replace(/<\/?loc>/gi, '').trim()).filter(Boolean);
  } catch (_) {}
  const total = urls.length;
  const offset = total ? (dayOfYear() * window) % total : 0;
  const slice = urls.slice(offset, offset + window);

  // 2) check them (200 expected). budget-bounded.
  const broken = [];
  await pool(slice, 12, async (u) => {
    if (Date.now() - start > BUDGET) return;
    const s = await status(u, false);
    if (s.code !== 200) broken.push({ url: u.replace(SITE, ''), code: s.code });
  });

  // 3) redirect integrity
  const redirectFails = [];
  for (const [from, to] of REDIRECT_CHECKS) {
    const s = await status(SITE + from, true);
    if (s.code < 300 || s.code >= 400 || !(s.location || '').endsWith(to)) redirectFails.push({ from, expected: to, got: s.code + ' ' + (s.location || '').replace(SITE, '') });
  }

  // 4) dedup vs last run — only alert on NEW breaks
  let prevSet = new Set();
  try { const row = await crud.searchOne(crud.TABLES.event_log, { action: 'site_health_state' }, { id: 'desc' }); let m = row && row.metadata; if (typeof m === 'string') m = JSON.parse(m); prevSet = new Set((m && m.broken) || []); } catch (_) {}
  const brokenKeys = broken.map((b) => b.url);
  const newBroken = broken.filter((b) => !prevSet.has(b.url));
  const newRedirectFails = redirectFails;   // redirect breaks always matter

  if (!dry) {
    try { await crud.logEvent('site_health_state', { broken: [...new Set([...prevSet, ...brokenKeys])].slice(-300), checked: slice.length, at_ms: Date.now() }); } catch (_) {}
    try { await crud.logEvent('site_health_run', { checked: slice.length, broken: broken.length, new_broken: newBroken.length, redirect_fails: redirectFails.length, offset, total }); } catch (_) {}
    if (newBroken.length || newRedirectFails.length) {
      let body = '[ant] 🧹 Site health — issues found:\n';
      if (newBroken.length) body += `\n${newBroken.length} broken page(s):\n` + newBroken.slice(0, 8).map((b) => `  • ${b.url} (${b.code || 'no response'})`).join('\n');
      if (newRedirectFails.length) body += `\n${newRedirectFails.length} redirect(s) not firing:\n` + newRedirectFails.slice(0, 6).map((r) => `  • ${r.from} → got ${r.got}`).join('\n');
      try { await sendSms(OWNER, body, 'owner', 'site_health'); } catch (_) {}
    }
  }

  return json(200, { ok: true, mode: dry ? 'dryrun' : 'live', sitemap_total: total, checked: slice.length, window_offset: offset, broken: broken.length, new_broken: newBroken.length, redirect_fails: redirectFails.length, broken_sample: broken.slice(0, 15), redirect_fails_detail: redirectFails });
};
