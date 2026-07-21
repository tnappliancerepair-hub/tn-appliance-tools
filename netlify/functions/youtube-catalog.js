// youtube-catalog — lists the TN Appliance YouTube channel's videos by view count,
// and (on demand) fires the top clippable ones into the video machine. Owner-gated.
//   GET ?secret=&handle=            -> the catalog, sorted by views
//   GET ?secret=&import=8           -> clip the top 8 clippable videos (>=45s), skip already-imported
//   GET ?secret=&ids=ID1,ID2        -> clip these specific video ids
'use strict';
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const ytdata = require('./_lib/youtube-data');

const DEFAULT_HANDLE = 'tnapplianceexchangellc6753';
const DONE_KEY = 'YT_CATALOG_IMPORTED'; // remembers which video ids we've already clipped
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

async function fireClip(v) {
  const body = { secret: (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5', video_url: v.url, video_type: 2, project_name: v.title.slice(0, 80), content_type: 'hero', mode: 'vizard', max_clips: 4 };
  try { const r = await fetch('https://tnapplianceexchange.net/.netlify/functions/video-clip-submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json(); return !!d.ok; }
  catch (_) { return false; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { error: 'unauthorized' });
  if (!(await ytdata.configured())) return json(200, { ok: false, configured: false, note: 'Add YOUTUBE_DATA_API_KEY in the vault (YouTube Data API v3 key — no OAuth needed).' });

  const cat = await ytdata.listAllVideos(q.handle || DEFAULT_HANDLE);
  if (!cat.ok) return json(502, { error: 'catalog_failed', detail: cat.error || cat.detail });

  let done = []; try { done = JSON.parse((await getSecretFresh(DONE_KEY)) || '[]'); } catch (_) {}

  // Import path: clip specific ids, or the top N clippable (>=45s, not a Short, not already done)
  if (q.import || q.ids) {
    let picks;
    if (q.ids) { const set = new Set(q.ids.split(',').map((s) => s.trim())); picks = cat.videos.filter((v) => set.has(v.id)); }
    else {
      const n = Math.min(Math.max(parseInt(q.import, 10) || 5, 1), 20);
      picks = cat.videos.filter((v) => v.length_s >= 45 && !done.includes(v.id)).slice(0, n);
    }
    let fired = 0; const list = [];
    for (const v of picks) { const ok = await fireClip(v); if (ok) { fired++; done.push(v.id); list.push({ title: v.title, views: v.views }); } await new Promise((r) => setTimeout(r, 1500)); }
    await setSecret(DONE_KEY, JSON.stringify(done.slice(-300)));
    return json(200, { ok: true, channel: cat.channel.title, fired, clips_each: 4, imported: list, note: 'Clips land in the Studio queue in a few minutes.' });
  }

  // List path
  return json(200, {
    ok: true, channel: cat.channel.title, subscribers: cat.channel.subs, total_videos: cat.videos.length,
    already_imported: done.length,
    top: cat.videos.slice(0, 40).map((v) => ({ views: v.views, length_s: v.length_s, published: v.published, title: v.title, id: v.id, imported: done.includes(v.id) })),
  });
};
