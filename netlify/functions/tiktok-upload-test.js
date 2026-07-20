// Owner-gated one-time TikTok upload test. Proves the Content Posting API works
// end-to-end: mint an access token from the vaulted refresh token, grab a real
// TN Appliance video (latest from the Facebook page, or ?videoUrl=<mp4>), and
// push it into the TikTok DRAFTS via FILE_UPLOAD. On success it lands in the
// @tn.appliance.exch TikTok inbox ("Upload from other apps") to finish + post.
//
//   GET ?secret=<VAPI_ADMIN_SECRET>            -> latest FB video -> TikTok drafts
//   GET ?secret=...&videoUrl=https://.../x.mp4 -> that specific video
//
// This is the flow the App-review demo video records. Remove after audit passes.
'use strict';

const { getSecret } = require('./_lib/secrets');
const { graphGet } = require('./_lib/social-fb');
const { freshAccessToken, uploadFileToInbox, fetchVideoBuffer } = require('./_lib/tiktok');

function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { error: 'unauthorized' });

  // 1) Resolve a video URL.
  let videoUrl = q.videoUrl || null;
  let videoTitle = q.videoUrl ? 'custom' : null;
  if (!videoUrl) {
    const token = await getSecret('SOCIAL_FB_PAGE_TOKEN');
    const pageId = await getSecret('SOCIAL_FB_PAGE_ID');
    if (!token || !pageId) return json(400, { error: 'facebook_not_connected', note: 'pass ?videoUrl=<public mp4> instead' });
    const vids = await graphGet(`/${pageId}/videos`, { fields: 'id,title,description,source', limit: 5, access_token: token });
    const list = (vids.data && vids.data.data) || [];
    const withSrc = list.find((v) => v.source);
    if (!withSrc) return json(502, { error: 'no_fb_video_source', detail: vids.data });
    videoUrl = withSrc.source;
    videoTitle = withSrc.title || withSrc.description || withSrc.id;
  }

  // 2) Mint a fresh TikTok access token from the vaulted refresh token.
  const at = await freshAccessToken();
  if (!at.ok) return json(502, { step: 'token', error: at.error, detail: at.detail || null });

  // 3) Download the bytes and push them to the TikTok drafts.
  const vid = await fetchVideoBuffer(videoUrl);
  if (!vid.ok) return json(502, { step: 'download', error: vid.error, status: vid.status, videoUrl });

  const up = await uploadFileToInbox(at.access_token, vid.buffer);
  return json(up.ok ? 200 : 502, {
    ok: up.ok,
    landed_where: up.ok ? 'TikTok drafts (@tn.appliance.exch → Inbox → "Upload from other apps") — open TikTok to add caption + post' : undefined,
    video: { title: videoTitle, url: videoUrl, size_bytes: vid.size, size_mb: +(vid.size / 1048576).toFixed(2) },
    upload: up,
  });
};
