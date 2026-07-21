// youtube-upload — manual push of ONE studio clip to YouTube with your own title +
// description (the video-studio "send this specific clip to YouTube" button). Owner-
// gated. Uploads PRIVATE by default (draft-first) — flip to public in Studio, or pass
// privacyStatus:"public". Records job.posted.youtube so the auto-engine won't re-upload,
// but leaves job.status untouched so the other platforms still fire.
//   POST { secret, job_id, title, description?, privacyStatus?="private" }
'use strict';
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const youtube = require('./_lib/youtube');
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });
  if (!b.job_id) return json(400, { error: 'job_id required' });
  if (!b.title) return json(400, { error: 'title required' });

  let queue = [];
  try { queue = JSON.parse((await getSecretFresh('VIDEO_STUDIO_QUEUE')) || '[]'); } catch (_) {}
  const job = queue.find((j) => (j.id || j.job_id) === b.job_id);
  if (!job) return json(404, { error: 'job_not_found' });
  if (!job.download_url) return json(200, { ok: false, error: 'clip_not_ready', status: job.status });

  const vb = await youtube.fetchVideoBuffer(job.download_url);
  if (!vb.ok) return json(200, { ok: false, step: 'download', detail: vb });

  const r = await youtube.uploadVideo(vb.buffer, {
    title: String(b.title).slice(0, 100),
    description: String(b.description || ''),
    privacyStatus: b.privacyStatus === 'public' ? 'public' : (b.privacyStatus || 'private'),
  });

  if (r && r.ok) {
    job.posted = job.posted || {};
    job.posted.youtube = { ok: true, video_id: r.video_id, url: r.url, privacy: r.privacy, at: Date.now() };
    try { await setSecret('VIDEO_STUDIO_QUEUE', JSON.stringify(queue)); } catch (_) {}
  }
  return json(200, { ok: !!(r && r.ok), title: b.title, bytes: vb.size, upload: r });
};
