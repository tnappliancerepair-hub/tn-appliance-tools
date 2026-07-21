// youtube-data — reads a PUBLIC YouTube channel's full upload list (titles, view
// counts, durations) via the YouTube Data API v3 with a simple API key (no OAuth).
// Lets us mine the whole back-catalog and clip the biggest hits automatically.
// Vault: YOUTUBE_DATA_API_KEY (a public API key, YouTube Data API v3 enabled).
'use strict';
const { getSecretPreferVault } = require('./secrets');

const BASE = 'https://www.googleapis.com/youtube/v3';
async function key() { return getSecretPreferVault('YOUTUBE_DATA_API_KEY'); }
async function configured() { return !!(await key()); }

async function api(path, params) {
  const k = await key();
  if (!k) return { ok: false, status: 0, error: 'not_configured' };
  const u = new URL(BASE + path);
  u.searchParams.set('key', k);
  for (const [a, b] of Object.entries(params)) if (b != null && b !== '') u.searchParams.set(a, b);
  try { const r = await fetch(u.toString()); const d = await r.json(); return { ok: r.ok, status: r.status, data: d }; }
  catch (e) { return { ok: false, status: 0, error: String((e && e.message) || e) }; }
}

// ISO-8601 duration (PT#M#S) -> seconds.
function durSec(iso) {
  const m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0, 10) * 3600) + (parseInt(m[2] || 0, 10) * 60) + parseInt(m[3] || 0, 10);
}

async function channelByHandle(handle) {
  const h = '@' + String(handle || '').replace(/^@/, '');
  const r = await api('/channels', { part: 'contentDetails,statistics,snippet', forHandle: h });
  if (!r.ok || !r.data.items || !r.data.items.length) return { ok: false, error: 'channel_not_found', detail: r.data };
  const c = r.data.items[0];
  return { ok: true, channelId: c.id, title: c.snippet.title, uploads: c.contentDetails.relatedPlaylists.uploads, subs: +(c.statistics.subscriberCount || 0), videoCount: +(c.statistics.videoCount || 0) };
}

async function listAllVideos(handle) {
  const ch = await channelByHandle(handle);
  if (!ch.ok) return ch;
  const ids = []; let pageToken = '';
  do {
    const r = await api('/playlistItems', { part: 'contentDetails', playlistId: ch.uploads, maxResults: 50, pageToken });
    if (!r.ok) break;
    (r.data.items || []).forEach((it) => ids.push(it.contentDetails.videoId));
    pageToken = r.data.nextPageToken || '';
  } while (pageToken && ids.length < 600);

  const vids = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await api('/videos', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(',') });
    if (r.ok) (r.data.items || []).forEach((v) => vids.push({
      id: v.id, title: (v.snippet && v.snippet.title) || '', views: +((v.statistics && v.statistics.viewCount) || 0),
      published: ((v.snippet && v.snippet.publishedAt) || '').slice(0, 10), length_s: durSec(v.contentDetails && v.contentDetails.duration),
      url: 'https://www.youtube.com/watch?v=' + v.id,
    }));
  }
  vids.sort((a, b) => b.views - a.views);
  return { ok: true, channel: ch, videos: vids };
}

module.exports = { key, configured, channelByHandle, listAllVideos, durSec };
