// Force Facebook to re-read our Open Graph tags.
//
// FB caches a link's card the first time anyone shares it and will serve that
// stale card for weeks. So changing og:title on the site does NOT change what
// people see on a link that has already been posted - the old card keeps running.
// This is the "Scrape Again" button in FB's Sharing Debugger, done over the API so
// it covers every page in one call instead of one paste at a time.
//
// The only thing it mutates is FB's cache. Nothing is posted.
//   GET ?secret=<VAPI_ADMIN_SECRET>                -> rescrape the default set
//   GET ?secret=...&urls=/a.html,/b.html           -> rescrape a specific list
'use strict';

const { getSecret } = require('./_lib/secrets');
const { GRAPH } = require('./_lib/social-fb');

const SITE = 'https://tnapplianceexchange.net';

// The pages that actually get posted. Bare domain first - it is the common case.
const DEFAULTS = ['/', '/appliance-ai.html', '/always-open.html', '/about.html'];

function json(code, obj) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj, null, 2) };
}

function absolute(u) {
  const s = String(u || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return SITE + (s.startsWith('/') ? s : '/' + s);
}

// FB's scrape endpoint takes its params on the QUERY STRING, not in a JSON body -
// which is why this does its own fetch instead of reusing graphPost.
async function scrape(url, token) {
  const u = new URL(GRAPH + '/');
  u.searchParams.set('id', url);
  u.searchParams.set('scrape', 'true');
  u.searchParams.set('access_token', token);
  try {
    const r = await fetch(u.toString(), { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    return { status: r.status, data: d };
  } catch (e) {
    return { status: 0, data: { error: { message: String((e && e.message) || e) } } };
  }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { error: 'unauthorized' });

  const token = await getSecret('SOCIAL_FB_PAGE_TOKEN');
  if (!token) return json(400, { ok: false, error: 'facebook not connected - SOCIAL_FB_PAGE_TOKEN not vaulted' });

  const list = (q.urls ? String(q.urls).split(',') : DEFAULTS)
    .map(absolute)
    .filter(Boolean)
    .slice(0, 25);

  const results = [];
  for (const url of list) {
    const { status, data } = await scrape(url, token);
    const err = data && data.error;
    // Report what FB now believes the card says. That read-back is the real proof
    // the scrape landed - a 200 on its own only means the request was accepted.
    results.push({
      ok: !err && status >= 200 && status < 300,
      url,
      title: data.title || null,
      description: data.description || null,
      image: (Array.isArray(data.image) && data.image[0] && data.image[0].url) || null,
      error: err ? (err.message || String(err)) : null,
    });
  }

  const good = results.filter((x) => x.ok).length;
  return json(200, { ok: good === results.length, rescraped: good, of: results.length, results });
};
