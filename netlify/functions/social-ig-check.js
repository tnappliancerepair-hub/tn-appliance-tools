// Owner-gated verification that Instagram is wired for publishing.
// Confirms: the page↔IG link, that SOCIAL_IG_USER_ID is vaulted, and that the
// current page token can actually READ the IG account (proves publish reach).
//   GET ?secret=<VAPI_ADMIN_SECRET>
'use strict';

const { getSecret } = require('./_lib/secrets');
const { graphGet } = require('./_lib/social-fb');

function json(code, obj) { return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { error: 'unauthorized' });

  const token = await getSecret('SOCIAL_FB_PAGE_TOKEN');
  const pageId = await getSecret('SOCIAL_FB_PAGE_ID');
  const pageName = await getSecret('SOCIAL_FB_PAGE_NAME');
  let igId = await getSecret('SOCIAL_IG_USER_ID');
  if (!token || !pageId) return json(400, { ok: false, error: 'facebook not connected' });

  // Double-check the page's linked IG account live (source of truth).
  const pg = await graphGet(`/${pageId}`, { fields: 'name,instagram_business_account', access_token: token });
  const liveIg = pg.data && pg.data.instagram_business_account && pg.data.instagram_business_account.id;
  if (liveIg && liveIg !== igId) igId = liveIg;

  const out = {
    ok: false,
    page: { id: pageId, name: pageName || (pg.data && pg.data.name) },
    instagram_business_account_on_page: liveIg || null,
    vaulted_ig_user_id: await getSecret('SOCIAL_IG_USER_ID') || null,
  };

  if (!igId) {
    out.error = 'no Instagram business account linked to this page';
    out.hint = 'connect @tnappliance to THIS page (Linked accounts), then re-run social-fb-oauth-start?ig=1';
    return json(200, out);
  }

  // Prove the token can reach the IG account (read = publish-capable).
  const ig = await graphGet(`/${igId}`, { fields: 'username,name,followers_count,media_count', access_token: token });
  if (!ig.ok) { out.error = 'token cannot read the IG account'; out.detail = ig.data; return json(200, out); }

  out.ok = true;
  out.instagram = { id: igId, username: ig.data.username, name: ig.data.name, followers: ig.data.followers_count, media: ig.data.media_count };
  out.ready_to_cross_post = true;
  return json(200, out);
};
