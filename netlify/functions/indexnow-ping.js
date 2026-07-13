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
// Priority pages: homepage + the cash-lead city hubs we optimize most.
const DEFAULTS = ['/', '/nashville', '/antioch', '/la-vergne', '/murfreesboro', '/smyrna'];

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const paths = (q.urls ? q.urls.split(',') : DEFAULTS).map((s) => s.trim()).filter(Boolean);
  const urlList = paths.map((p) => (p.startsWith('http') ? p : `https://${HOST}${p.startsWith('/') ? '' : '/'}${p}`)).slice(0, 10000);

  try {
    const r = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOC, urlList }),
      signal: AbortSignal.timeout(15000),
    });
    const t = await r.text().catch(() => '');
    // IndexNow returns 200 (accepted) or 202 (received, pending) on success.
    return json(200, { ok: r.status >= 200 && r.status < 300, status: r.status, submitted: urlList.length, urls: urlList, response: t.slice(0, 200) });
  } catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }
};
