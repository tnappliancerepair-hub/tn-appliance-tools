// Background Instagram cross-post (fired by social-campaign approve for video posts).
// IG video publishing is async (container must finish processing before publish),
// which can exceed a sync function's timeout — so this runs as a 15-min background fn.
//
// Flow: resolve the Facebook video's direct source URL -> create an IG Reels
// container -> poll until FINISHED -> publish. Result is appended to the campaign
// log so the drafts page shows whether IG landed. All failures are graceful (the
// FB post already went out; IG just falls back to the one-tap "post everywhere" copy).
'use strict';

const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const { graphGet, igPublish } = require('./_lib/social-fb');

async function appendLog(entry) {
  let s = {};
  try { s = JSON.parse((await getSecretFresh('SOCIAL_CAMPAIGN_STATE')) || '{}'); } catch (_) { s = {}; }
  s.log = s.log || [];
  s.log.push(entry);
  if (s.log.length > 40) s.log = s.log.slice(-40);
  await setSecret('SOCIAL_CAMPAIGN_STATE', JSON.stringify(s));
}

exports.handler = async function (event) {
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const { key, title, videoId, caption } = body;

  const token = await getSecret('SOCIAL_FB_PAGE_TOKEN');
  const igId = await getSecret('SOCIAL_IG_USER_ID');
  if (!token || !igId) { await appendLog({ key, title, action: 'ig_skipped', reason: 'instagram_not_connected', at: Date.now() }); return { statusCode: 200, body: 'ok' }; }
  if (!videoId) { await appendLog({ key, title, action: 'ig_skipped', reason: 'no_video', at: Date.now() }); return { statusCode: 200, body: 'ok' }; }

  // Resolve the Facebook video's direct (CDN) source URL — IG can ingest that.
  const v = await graphGet(`/${videoId}`, { fields: 'source', access_token: token });
  const src = v.data && v.data.source;
  if (!src) { await appendLog({ key, title, action: 'ig_failed', reason: 'no_source_url', detail: v.data && v.data.error, at: Date.now() }); return { statusCode: 200, body: 'ok' }; }

  const r = await igPublish(igId, token, { caption: caption || '', videoUrl: src });
  if (r.ok) await appendLog({ key, title, action: 'ig_published', ig_media_id: r.id, at: Date.now() });
  else await appendLog({ key, title, action: 'ig_failed', reason: r.step || 'publish', detail: r.detail || r.error || null, at: Date.now() });
  return { statusCode: 200, body: 'ok' };
};
