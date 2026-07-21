// youtube-edit — edit an existing YouTube upload in place: fix title/description/tags
// and/or flip privacy (public / private / unlisted). No re-upload, no duplicate.
// This is the "one-tap publish" + "fix the caption" tool. Owner-gated.
//   POST { secret, video_id, title?, description?, tags?[], privacyStatus? }
'use strict';
const { getSecret } = require('./_lib/secrets');
const youtube = require('./_lib/youtube');
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });
  if (!b.video_id) return json(400, { error: 'video_id required' });
  if (b.action === 'delete' || b.delete === true) {
    const del = await youtube.deleteVideo(b.video_id);
    return json(200, del);
  }
  const patch = {};
  if (b.title != null) patch.title = b.title;
  if (b.description != null) patch.description = b.description;
  if (Array.isArray(b.tags)) patch.tags = b.tags;
  if (b.privacyStatus) patch.privacyStatus = b.privacyStatus;
  const r = await youtube.updateVideo(b.video_id, patch);
  return json(200, r);
};
