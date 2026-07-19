// Facebook / Meta Graph connector for the TN Appliance social engine.
// One-time OAuth (social-fb-oauth-start → -callback) mints a LONG-LIVED Page
// access token and vaults SOCIAL_FB_PAGE_TOKEN / SOCIAL_FB_PAGE_ID / SOCIAL_IG_USER_ID
// (the exact keys social-post-generator.js already reads). Page tokens derived
// from a long-lived user token do not expire, so this is a set-once hookup.
//
// App creds come from the vault: SOCIAL_FB_APP_ID / SOCIAL_FB_APP_SECRET.
'use strict';

const GRAPH = 'https://graph.facebook.com/v21.0';
const REDIRECT = 'https://tnapplianceexchange.net/.netlify/functions/social-fb-oauth-callback';

// Permissions from the "Manage everything on your Page" use case — the full page
// toolkit: publish, read the page + its video library, analytics, comment
// moderation, read customer content, and webhooks (real-time activity). Each must
// be ADDED in the use case (Ready for testing) or the login dialog returns
// "Invalid Scopes" — keep this list matched to what's added there. Instagram +
// pages_messaging are separate use cases added later.
const PAGE_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_engagement',
  'pages_read_user_content',
  'pages_manage_metadata',
  'read_insights',
];
const SCOPES = PAGE_SCOPES.join(',');

// Instagram publishing scopes — ONLY request these after they've been ADDED in
// the app (Instagram use case, "Ready for testing"), or the login returns
// "Invalid Scopes". The start endpoint requests these only on ?ig=1, so the base
// Facebook re-connect never breaks if IG perms aren't in yet.
const SCOPES_IG = [...PAGE_SCOPES, 'instagram_basic', 'instagram_content_publish'].join(',');

function defaultRedirect() { return REDIRECT; }

// GET the Graph API. Returns {ok, status, data}. Never throws.
async function graphGet(path, params) {
  const u = new URL(GRAPH + path);
  Object.entries(params || {}).forEach(([k, v]) => { if (v != null) u.searchParams.set(k, v); });
  try {
    const r = await fetch(u.toString());
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) {
    return { ok: false, status: 0, data: { error: { message: String((e && e.message) || e) } } };
  }
}

// POST JSON to the Graph API. Returns {ok, status, data}. Never throws.
async function graphPost(path, body) {
  try {
    const r = await fetch(GRAPH + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) {
    return { ok: false, status: 0, data: { error: { message: String((e && e.message) || e) } } };
  }
}

// Publish to Instagram (2-step: create a media container, then publish it).
// IG REQUIRES a public image_url or video_url — it cannot post text-only. Video
// containers process async, so we poll status_code until FINISHED before publish.
async function igPublish(igUserId, token, { caption, imageUrl, videoUrl }) {
  const create = { access_token: token, caption: caption || '' };
  if (videoUrl) { create.media_type = 'REELS'; create.video_url = videoUrl; }
  else if (imageUrl) { create.image_url = imageUrl; }
  else return { ok: false, error: 'instagram requires an image_url or video_url (no text-only posts)' };

  const c = await graphPost(`/${igUserId}/media`, create);
  if (!c.ok || !c.data.id) return { ok: false, step: 'create', detail: c.data.error || c.data };
  const creationId = c.data.id;

  if (videoUrl) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const st = await graphGet(`/${creationId}`, { fields: 'status_code', access_token: token });
      const code = st.data && st.data.status_code;
      if (code === 'FINISHED') break;
      if (code === 'ERROR') return { ok: false, step: 'processing', creation_id: creationId, detail: st.data };
    }
  }

  const pub = await graphPost(`/${igUserId}/media_publish`, { access_token: token, creation_id: creationId });
  if (!pub.ok || !pub.data.id) return { ok: false, step: 'publish', creation_id: creationId, detail: pub.data.error || pub.data };
  return { ok: true, id: pub.data.id };
}

module.exports = { GRAPH, SCOPES, SCOPES_IG, defaultRedirect, graphGet, graphPost, igPublish };
