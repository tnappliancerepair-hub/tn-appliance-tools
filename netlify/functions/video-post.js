// video-post — the "distribute" stage. Takes a FINISHED (captioned) clip from the
// studio queue and fans it out natively to every platform, with per-platform copy.
// This IS the approval step: nothing posts until Teddy taps "Post everywhere" in the
// studio (which calls this). Each platform is best-effort + independent.
//
//   Facebook  -> native video (plays inline)                     [publishes live]
//   Instagram -> Reel                                            [publishes live]
//   TikTok    -> uploaded to DRAFTS (tap Post in the app)        [draft-first]
//   YouTube   -> uploaded PRIVATE (flip to public in YT)         [draft-first]
//
//   POST { secret, job_id, platforms?:["facebook","instagram","tiktok","youtube"], caption? }
'use strict';
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const { variantsFor } = require('./_lib/social-variants');
const { igPublish } = require('./_lib/social-fb');
const tiktok = require('./_lib/tiktok');
const youtube = require('./_lib/youtube');

const QUEUE_KEY = 'VIDEO_STUDIO_QUEUE';
const ALL = ['facebook', 'instagram', 'tiktok', 'youtube'];
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }
async function loadQueue() { try { return JSON.parse((await getSecretFresh(QUEUE_KEY)) || '[]'); } catch (_) { return []; } }
async function saveQueue(q) { await setSecret(QUEUE_KEY, JSON.stringify(q)); }

async function fbEdge(pageId, edge, body) {
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${pageId}/${edge}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json(); return { ok: r.ok && !!d.id, id: d.id, err: d.error };
  } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });

  const queue = await loadQueue();
  const job = queue.find((j) => String(j.id) === String(b.job_id));
  if (!job) return json(404, { error: 'job_not_found' });
  if (job.status !== 'ready' && job.status !== 'posted') return json(400, { error: 'not_ready', status: job.status });
  const url = job.download_url;
  if (!url) return json(400, { error: 'no_finished_video' });

  const want = Array.isArray(b.platforms) && b.platforms.length ? b.platforms.filter((p) => ALL.includes(p)) : ALL;
  const item = { key: job.content_type || 'hero', kind: 'video', title: job.title, message: String(b.caption || job.title || 'TN Appliance').trim(), link: null };
  const v = variantsFor(item) || {};
  const out = {};
  job.posted = job.posted || {};

  // Facebook — native video
  if (want.includes('facebook')) {
    const token = await getSecret('SOCIAL_FB_PAGE_TOKEN');
    const pageId = await getSecret('SOCIAL_FB_PAGE_ID');
    if (!token || !pageId) out.facebook = { ok: false, reason: 'not_connected' };
    else {
      const r = await fbEdge(pageId, 'videos', { file_url: url, description: (v.facebook && v.facebook.text) || item.message, access_token: token });
      out.facebook = r.ok ? { ok: true, id: r.id, url: `https://www.facebook.com/${r.id}` } : { ok: false, reason: (r.err && r.err.message) || r.err || 'failed' };
    }
  }

  // Instagram — Reel
  if (want.includes('instagram')) {
    const token = await getSecret('SOCIAL_FB_PAGE_TOKEN');
    const igId = await getSecret('SOCIAL_IG_USER_ID');
    if (!token || !igId) out.instagram = { ok: false, reason: 'not_connected' };
    else {
      try { const r = await igPublish(igId, token, { caption: (v.instagram && v.instagram.text) || item.message, videoUrl: url }); out.instagram = r.ok ? { ok: true, id: r.id } : { ok: false, reason: r.error || r.step || 'failed' }; }
      catch (e) { out.instagram = { ok: false, reason: String((e && e.message) || e) }; }
    }
  }

  // TikTok — push to drafts (FILE_UPLOAD)
  if (want.includes('tiktok')) {
    try {
      const at = await tiktok.freshAccessToken();
      if (!at || !at.access_token) out.tiktok = { ok: false, reason: at && at.error ? at.error : 'not_connected' };
      else {
        const vb = await tiktok.fetchVideoBuffer(url);
        if (!vb.ok) out.tiktok = { ok: false, reason: 'download_failed' };
        else { const r = await tiktok.uploadFileToInbox(at.access_token, vb.buffer); out.tiktok = r && r.ok ? { ok: true, drafts: true, publish_id: r.publish_id || r.publishId } : { ok: false, reason: (r && (r.error || r.step)) || 'failed' }; }
      }
    } catch (e) { out.tiktok = { ok: false, reason: String((e && e.message) || e) }; }
  }

  // YouTube — upload private (Short if vertical/<=60s); flip to public in YT
  if (want.includes('youtube')) {
    try {
      const yt = v.youtube || { title: item.title, description: item.message };
      const vb = await youtube.fetchVideoBuffer(url);
      if (!vb.ok) out.youtube = { ok: false, reason: 'download_failed' };
      else { const r = await youtube.uploadVideo(vb.buffer, { title: yt.title, description: yt.description, privacyStatus: 'private' }); out.youtube = r && r.ok ? { ok: true, video_id: r.video_id, url: r.url, privacy: r.privacy } : { ok: false, reason: (r && (r.error || r.step)) || 'failed' }; }
    } catch (e) { out.youtube = { ok: false, reason: String((e && e.message) || e) }; }
  }

  // Record results on the job; mark posted if anything landed.
  for (const k of Object.keys(out)) job.posted[k] = { ...out[k], at: Date.now() };
  if (Object.values(out).some((r) => r && r.ok)) job.status = 'posted';
  await saveQueue(queue);
  return json(200, { ok: true, job_id: job.id, results: out });
};
