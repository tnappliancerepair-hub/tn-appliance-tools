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
// Only what we demonstrate: user.info.basic (Login Kit, confirm account) +
// video.publish (Content Posting API Direct Post). video.publish isn't in the
// "Add scopes" list — it's granted by the Content Posting API product itself.
const SCOPES = 'user.info.basic,video.publish';

function defaultRedirect() { return REDIRECT; }
function scopes() { return SCOPES; }

async function authorizeUrl(state) {
  const key = await getSecretPreferVault('TIKTOK_CLIENT_KEY');
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
  const key = await getSecretPreferVault('TIKTOK_CLIENT_KEY');
  const secret = await getSecretPreferVault('TIKTOK_CLIENT_SECRET');
  return postForm('/oauth/token/', { client_key: key, client_secret: secret, code, grant_type: 'authorization_code', redirect_uri: REDIRECT });
}

// Refresh the access token from the vaulted refresh token.
async function freshAccessToken() {
  const key = await getSecretPreferVault('TIKTOK_CLIENT_KEY');
  const secret = await getSecretPreferVault('TIKTOK_CLIENT_SECRET');
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

// Direct-post a video by pulling it from a public URL (domain must be a verified
// URL property in the app). privacy SELF_ONLY until audited.
async function publishFromUrl(accessToken, { videoUrl, title, privacy }) {
  const body = {
    post_info: { title: title || '', privacy_level: privacy || 'SELF_ONLY', disable_comment: false, disable_duet: false, disable_stitch: false },
    source_info: { source: 'PULL_FROM_URL', video_url: videoUrl },
  };
  try {
    const r = await fetch(`${API}/post/publish/video/init/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok && d.data && d.data.publish_id, status: r.status, publish_id: d.data && d.data.publish_id, data: d };
  } catch (e) { return { ok: false, status: 0, data: { error: String((e && e.message) || e) } }; }
}

module.exports = { defaultRedirect, scopes, authorizeUrl, tokenFromCode, freshAccessToken, publishFromUrl, API, REDIRECT };
