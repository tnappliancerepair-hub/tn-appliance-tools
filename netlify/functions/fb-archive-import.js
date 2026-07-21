// fb-archive-import — thin trigger for the Studio "Load Facebook archive" button.
// Counts how many golden-era Page videos aren't in the Studio yet, fires the
// background importer, and returns immediately.
//   GET/POST { secret } [ &all=1 &before=2017-01-01 ]
'use strict';
const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { graphGet } = require('./_lib/social-fb');

const QUEUE_KEY = 'VIDEO_STUDIO_QUEUE';
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }; }

exports.handler = async function (event) {
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const secret = q.secret || b.secret;
  if (secret !== admin) return json(401, { error: 'unauthorized' });

  const token = await getSecret('SOCIAL_FB_PAGE_TOKEN');
  const pageId = await getSecret('SOCIAL_FB_PAGE_ID');
  if (!token || !pageId) return json(400, { error: 'fb_page_not_connected' });

  const all = q.all === '1' || b.all === true;
  const before = String(q.before || b.before || '2017-01-01');
  const cutMs = Date.parse(before + 'T00:00:00Z');

  let queue = []; try { queue = JSON.parse((await getSecretFresh(QUEUE_KEY)) || '[]'); } catch (_) {}
  const have = new Set(queue.map((j) => j.fb_id).filter(Boolean));

  const r = await graphGet('/' + pageId + '/videos', { access_token: token, fields: 'id,created_time,source', limit: 50 });
  if (!r.ok) return json(502, { error: 'fb_videos_failed' });
  const vids = ((r.data && r.data.data) || []).filter((v) => v.source);
  const eligible = vids.filter((v) => (all || (v.created_time && Date.parse(v.created_time) < cutMs)) && !have.has(v.id));

  // fire the background worker (returns 202, runs up to 15 min)
  const base = 'https://tnapplianceexchange.net/.netlify/functions/fb-archive-import-background';
  try { fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ internal: true, all, before }) }).catch(() => {}); } catch (_) {}

  return json(202, { ok: true, will_import: eligible.length, already_have: have.size, note: 'Importing in the background — refresh the Studio in a minute.' });
};
