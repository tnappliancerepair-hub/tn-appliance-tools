// video-enrich — thin trigger for the Studio "Punch up everything" button. Counts
// clips not yet punched up, fires the background enricher (hooks + SEO), returns now.
//   GET/POST { secret } [ &force=1 ]
'use strict';
const { getSecret, getSecretFresh } = require('./_lib/secrets');
const QUEUE_KEY = 'VIDEO_STUDIO_QUEUE';
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }; }

exports.handler = async function (event) {
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const secret = q.secret || b.secret;
  if (secret !== admin) return json(401, { error: 'unauthorized' });
  const force = q.force === '1' || b.force === true;

  let queue = []; try { queue = JSON.parse((await getSecretFresh(QUEUE_KEY)) || '[]'); } catch (_) {}
  const pending = queue.filter((j) => j.status === 'ready' && (force || !j.enriched)).length;

  const base = 'https://tnapplianceexchange.net/.netlify/functions/video-enrich-background';
  try { fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ internal: true, force }) }).catch(() => {}); } catch (_) {}

  return json(202, { ok: true, punching_up: pending, note: 'Writing hooks + SEO in the background — refresh in a minute.' });
};
