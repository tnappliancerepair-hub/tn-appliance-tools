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

// Permissions from the "Manage everything on your Page" use case ONLY — publish
// posts, read the page + its content/videos, and moderate comments. Instagram,
// messaging (pages_messaging), and insights are separate use cases we add later;
// requesting them before their use case exists returns "Invalid Scopes" and
// breaks the whole login dialog, so keep this list matched to the added use case.
const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_engagement',
  'pages_read_user_content',
].join(',');

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

module.exports = { GRAPH, SCOPES, defaultRedirect, graphGet };
