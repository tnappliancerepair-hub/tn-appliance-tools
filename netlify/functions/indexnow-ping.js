// indexnow-ping — push updated URLs to IndexNow (Bing, Yandex, Seznam, etc.) so they
// re-crawl within hours instead of waiting for a natural crawl. Google doesn't use
// IndexNow, but Bing/Yandex do, and fast Bing indexing is still free traffic + a signal.
//
// Admin-gated. GET ?secret=<admin>[&urls=/path1,/path2,...]  (defaults to priority pages)
'use strict';
const { getSecret } = require('./_lib/secrets');

const HOST = 'tnapplianceexchange.net';
const KEY = '2ff3da0fb2cd75d8c364edbf26878166';
const KEY_LOC = `https://${HOST}/${KEY}.txt`;
// Priority cash-lead pages re-submitted on every scheduled run: homepage + service
// hubs + the TN/LA city hubs. IndexNow is cheap + deduped, so a daily refresh keeps
// Bing/Yandex crawling our money pages.
const DEFAULTS = [
  '/',
  '/same-day-appliance-repair',
  '/dryer-repair', '/washer-repair', '/refrigerator-repair', '/dishwasher-repair', '/oven-repair', '/dryer-vent-cleaning',
  '/nashville', '/antioch', '/la-vergne', '/murfreesboro', '/smyrna', '/franklin', '/brentwood', '/clarksville', '/hendersonville', '/hermitage', '/mt-juliet', '/gallatin', '/lebanon', '/spring-hill',
  '/new-orleans', '/baton-rouge', '/hammond', '/metairie', '/kenner', '/slidell', '/covington', '/mandeville',
];

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  // Scheduled (cron) invocations carry {next_run} in the body — those run the default
  // priority set with no secret. Manual HTTP calls still require the admin secret.
  let scheduled = false;
  try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled) {
    const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  }

  const paths = (q.urls ? q.urls.split(',') : DEFAULTS).map((s) => s.trim()).filter(Boolean);
  const urlList = paths.map((p) => (p.startsWith('http') ? p : `https://${HOST}${p.startsWith('/') ? '' : '/'}${p}`)).slice(0, 10000);

  try {
    const r = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOC, urlList }),
      // 7s — must stay under Netlify's 10s sync-function wall, or a slow IndexNow
      // response gets the whole function killed ("Internal Error") before it returns.
      signal: AbortSignal.timeout(7000),
    });
    const t = await r.text().catch(() => '');
    // IndexNow returns 200 (accepted) or 202 (received, pending) on success.
    return json(200, { ok: r.status >= 200 && r.status < 300, status: r.status, submitted: urlList.length, urls: urlList, response: t.slice(0, 200) });
  } catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }
};
