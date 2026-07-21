// youtube-upload-test — one-off proof that the YouTube upload path works end-to-end.
// Reads a READY clip from the studio queue (read-only, never mutates status), pulls
// its bytes, and uploads to the connected channel as a PRIVATE draft. Owner-gated.
// Mirrors the old tiktok-upload-test hygiene: temporary — remove once proven.
//   GET ?secret=<VAPI_ADMIN_SECRET>[&job_id=<id>][&url=<direct mp4>]
'use strict';
const { getSecret, getSecretFresh } = require('./_lib/secrets');
const youtube = require('./_lib/youtube');
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { error: 'unauthorized' });

  // Resolve a source video URL: explicit ?url=, or a READY clip from the queue.
  let url = q.url || '';
  let title = 'TN Appliance — upload test';
  if (!url) {
    let queue = [];
    try { queue = JSON.parse((await getSecretFresh('VIDEO_STUDIO_QUEUE')) || '[]'); } catch (_) {}
    const ready = queue.filter((j) => j.status === 'ready' && j.download_url);
    const pick = q.job_id ? ready.find((j) => (j.id || j.job_id) === q.job_id) : ready[0];
    if (!pick) return json(200, { ok: false, error: 'no_ready_clip', note: 'Pass ?url= or a valid ?job_id= of a ready clip.' });
    url = pick.download_url;
    title = (pick.project_name || pick.title || title).slice(0, 90);
  }

  const vb = await youtube.fetchVideoBuffer(url);
  if (!vb.ok) return json(200, { ok: false, step: 'download', detail: vb });

  const r = await youtube.uploadVideo(vb.buffer, {
    title,
    description: 'Test upload from the TN Appliance video engine — connection proof. TN Appliance Exchange · 615-280-2949 · tnapplianceexchange.net',
    privacyStatus: 'private',
  });
  return json(200, { ok: !!(r && r.ok), source_bytes: vb.size, title, upload: r });
};
