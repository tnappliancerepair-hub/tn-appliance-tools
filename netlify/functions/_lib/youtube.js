// YouTube connector — reuses the already-vaulted "Ant Ads" Google OAuth client
// (same Cloud project as GSC/GBP/Ads) with the youtube.upload scope, and mints a
// SEPARATE refresh token (YOUTUBE_REFRESH_TOKEN). Same proven pattern as
// _lib/search-console. Videos upload as PRIVATE drafts by default — nothing goes
// public until the owner flips it in YouTube Studio (mirrors the TikTok drafts model).
'use strict';
const { getSecretPreferVault } = require('./secrets');

const REDIRECT = 'https://tnapplianceexchange.net/.netlify/functions/youtube-oauth-callback';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// upload = push a video; readonly = confirm which channel is connected.
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';

async function creds() {
  const [id, secret, refresh] = await Promise.all([
    getSecretPreferVault('GOOGLE_ADS_CLIENT_ID'),
    getSecretPreferVault('GOOGLE_ADS_CLIENT_SECRET'),
    getSecretPreferVault('YOUTUBE_REFRESH_TOKEN'),
  ]);
  return { id, secret, refresh };
}

// Fresh access token from the refresh token.
async function accessToken() {
  const c = await creds();
  if (!c.id || !c.secret || !c.refresh) {
    return { ok: false, configured: false, missing: ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'].filter((k) => !({ GOOGLE_ADS_CLIENT_ID: c.id, GOOGLE_ADS_CLIENT_SECRET: c.secret, YOUTUBE_REFRESH_TOKEN: c.refresh }[k])) };
  }
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: c.id, client_secret: c.secret, refresh_token: c.refresh });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) return { ok: false, error: d.error || 'token_refresh_failed', detail: d.error_description || null };
  return { ok: true, access_token: d.access_token };
}

// Which channel is connected (name + subs) — the connection check.
async function getChannel() {
  const at = await accessToken();
  if (!at.ok) return at;
  const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', { headers: { Authorization: 'Bearer ' + at.access_token } });
  const d = await r.json().catch(() => ({}));
  const ch = d && d.items && d.items[0];
  if (!ch) return { ok: false, error: 'no_channel', detail: d };
  return { ok: true, channel: { id: ch.id, title: ch.snippet && ch.snippet.title, subs: ch.statistics && ch.statistics.subscriberCount, videos: ch.statistics && ch.statistics.videoCount } };
}

// Download a video's bytes (same helper shape as the TikTok connector).
async function fetchVideoBuffer(url) {
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return { ok: false, error: 'download_failed', status: r.status };
    const ab = await r.arrayBuffer();
    return { ok: true, buffer: Buffer.from(ab), size: ab.byteLength };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// Resumable upload → a PRIVATE video (owner flips to public in Studio).
// opts: { title, description, privacyStatus?='private' }
async function uploadVideo(buffer, opts) {
  opts = opts || {};
  const at = await accessToken();
  if (!at.ok) return at;
  const meta = {
    snippet: { title: String(opts.title || 'TN Appliance').slice(0, 100), description: String(opts.description || ''), categoryId: '26' /* Howto & Style */ },
    status: { privacyStatus: opts.privacyStatus || 'private', selfDeclaredMadeForKids: false },
  };
  // 1) open a resumable session
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + at.access_token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/*', 'X-Upload-Content-Length': String(buffer.length) },
    body: JSON.stringify(meta),
  });
  if (!(init.status >= 200 && init.status < 300)) { const t = await init.text().catch(() => ''); return { ok: false, step: 'init', status: init.status, detail: t.slice(0, 300) }; }
  const session = init.headers.get('location');
  if (!session) return { ok: false, step: 'init', error: 'no_session_uri' };
  // 2) upload the bytes
  const put = await fetch(session, { method: 'PUT', headers: { 'Content-Type': 'video/*', 'Content-Length': String(buffer.length) }, body: buffer });
  const d = await put.json().catch(() => ({}));
  if (!d.id) return { ok: false, step: 'upload', status: put.status, detail: d };
  return { ok: true, video_id: d.id, url: 'https://youtube.com/watch?v=' + d.id, privacy: (d.status && d.status.privacyStatus) || meta.status.privacyStatus };
}

module.exports = { REDIRECT, TOKEN_URL, SCOPE, creds, accessToken, getChannel, fetchVideoBuffer, uploadVideo };
