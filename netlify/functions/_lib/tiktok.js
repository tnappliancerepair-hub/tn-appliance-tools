// TikTok connector for the TN Appliance social engine (Content Posting API).
// One-time OAuth (tiktok-oauth-start -> -callback) vaults TIKTOK_REFRESH_TOKEN +
// TIKTOK_OPEN_ID for the TN Appliance TikTok account. Then the auto-poster can
// direct-post videos via PULL_FROM_URL.
//
// App creds from the vault: TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET.
// NOTE: until the app passes TikTok's audit, Direct Post is limited to
// privacy_level SELF_ONLY (private) on the developer's own account. That's fine
// for the sandbox demo video required for submission.
'use strict';

const { getSecretPreferVault, getSecret, setSecret } = require('./secrets');

const AUTHORIZE = 'https://www.tiktok.com/v2/auth/authorize/';
const API = 'https://open.tiktokapis.com/v2';
const REDIRECT = 'https://tnapplianceexchange.net/.netlify/functions/tiktok-oauth-callback';
// Draft/Upload mode (approvable path): user.info.basic (confirm account) +
// video.upload (Content Posting API "Upload to TikTok"). The video is auto-
// uploaded to the user's TikTok drafts; they open TikTok, add caption, and post.
const SCOPES = 'user.info.basic,video.upload';

function defaultRedirect() { return REDIRECT; }
function scopes() { return SCOPES; }

// Prefer sandbox credentials when present (unaudited testing) — production key
// can't do live OAuth until the app passes review. Once approved, clear the
// TIKTOK_SANDBOX_* vault keys and it falls back to production automatically.
async function clientKey() { return (await getSecretPreferVault('TIKTOK_SANDBOX_CLIENT_KEY')) || (await getSecretPreferVault('TIKTOK_CLIENT_KEY')); }
async function clientSecret() { return (await getSecretPreferVault('TIKTOK_SANDBOX_CLIENT_SECRET')) || (await getSecretPreferVault('TIKTOK_CLIENT_SECRET')); }

async function authorizeUrl(state) {
  const key = await clientKey();
  if (!key) return null;
  const u = new URL(AUTHORIZE);
  u.searchParams.set('client_key', key);
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', REDIRECT);
  u.searchParams.set('state', state || 'ant');
  return u.toString();
}

async function postForm(path, params) {
  try {
    const r = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) { return { ok: false, status: 0, data: { error: String((e && e.message) || e) } }; }
}

// code -> tokens (returns { access_token, refresh_token, open_id, expires_in, ... })
async function tokenFromCode(code) {
  const key = await clientKey();
  const secret = await clientSecret();
  return postForm('/oauth/token/', { client_key: key, client_secret: secret, code, grant_type: 'authorization_code', redirect_uri: REDIRECT });
}

// Refresh the access token from the vaulted refresh token.
async function freshAccessToken() {
  const key = await clientKey();
  const secret = await clientSecret();
  const refresh = await getSecret('TIKTOK_REFRESH_TOKEN');
  if (!key || !secret || !refresh) return { ok: false, error: 'not_connected' };
  const r = await postForm('/oauth/token/', { client_key: key, client_secret: secret, grant_type: 'refresh_token', refresh_token: refresh });
  if (r.ok && r.data.access_token) {
    // TikTok rotates the refresh token — persist the new one.
    if (r.data.refresh_token) { try { await setSecret('TIKTOK_REFRESH_TOKEN', r.data.refresh_token); } catch (_) {} }
    return { ok: true, access_token: r.data.access_token };
  }
  return { ok: false, error: r.data.error || r.data, detail: r.data };
}

// Upload a video to the user's TikTok DRAFTS by pulling it from a public URL
// (the domain must be a verified URL property in the app). The user then opens
// TikTok, adds the caption, and taps Post. This is the "Upload to TikTok" flow
// (video.upload) — the approvable path.
async function uploadToInbox(accessToken, { videoUrl }) {
  const body = { source_info: { source: 'PULL_FROM_URL', video_url: videoUrl } };
  try {
    const r = await fetch(`${API}/post/publish/inbox/video/init/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok && d.data && d.data.publish_id, status: r.status, publish_id: d.data && d.data.publish_id, data: d };
  } catch (e) { return { ok: false, status: 0, data: { error: String((e && e.message) || e) } }; }
}

// Download a public video's bytes (e.g. a Facebook fbcdn source URL). Returns a
// Buffer we can push straight to TikTok — no URL-property verification needed,
// which PULL_FROM_URL would require (fbcdn is not a verified domain).
async function fetchVideoBuffer(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return { ok: false, status: r.status, error: 'fetch_failed' };
    const ab = await r.arrayBuffer();
    return { ok: true, buffer: Buffer.from(ab), size: ab.byteLength, contentType: r.headers.get('content-type') || 'video/mp4' };
  } catch (e) { return { ok: false, status: 0, error: String((e && e.message) || e) }; }
}

// Upload a video to the user's TikTok DRAFTS via FILE_UPLOAD (we send the bytes),
// so the source can be any public video (Facebook, our site, anywhere). The user
// then opens TikTok, adds the caption, and taps Post — the "Upload to TikTok"
// (video.upload) flow, TikTok's approvable path. Single-chunk (video <= 64MB),
// which covers our short vertical clips.
async function uploadFileToInbox(accessToken, videoBuffer) {
  const size = videoBuffer.length;
  const MAX_SINGLE = 64 * 1024 * 1024;
  if (size > MAX_SINGLE) return { ok: false, step: 'size', error: 'video_too_large_for_single_chunk', size };

  const initBody = { source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 } };
  let initData;
  try {
    const r = await fetch(`${API}/post/publish/inbox/video/init/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(initBody),
    });
    const d = await r.json().catch(() => ({}));
    const okInit = r.ok && d.data && d.data.publish_id && d.data.upload_url;
    if (!okInit) return { ok: false, step: 'init', status: r.status, data: d };
    initData = d.data;
  } catch (e) { return { ok: false, step: 'init', error: String((e && e.message) || e) }; }

  try {
    const put = await fetch(initData.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes 0-${size - 1}/${size}` },
      body: videoBuffer,
    });
    const text = await put.text().catch(() => '');
    return { ok: put.ok, step: put.ok ? 'done' : 'upload', status: put.status, publish_id: initData.publish_id, detail: put.ok ? undefined : text };
  } catch (e) { return { ok: false, step: 'upload', publish_id: initData.publish_id, error: String((e && e.message) || e) }; }
}

module.exports = { defaultRedirect, scopes, authorizeUrl, tokenFromCode, freshAccessToken, uploadToInbox, uploadFileToInbox, fetchVideoBuffer, API, REDIRECT };
