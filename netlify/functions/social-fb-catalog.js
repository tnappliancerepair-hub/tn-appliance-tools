// Reads the connected Facebook page's video library + basic stats via the vaulted
// long-lived Page token. Used to inventory the "good old days" archive and build
// the campaign calendar from the best-performing old videos. Owner-gated.
//   /.netlify/functions/social-fb-catalog?secret=...            (top videos by views)
//   &full=1   include every video, not just the top 25
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
  if (!token || !pageId) return json(400, { error: 'not connected — run social-fb-oauth-start first' });

  // Page basics (confirms the token works + follower count)
  const me = await graphGet(`/${pageId}`, { access_token: token, fields: 'id,name,fan_count,followers_count,link,about,category' });

  // Video library (paginate)
  const videos = [];
  let after = null, pageN = 0, videoErr = null;
  do {
    const params = { access_token: token, fields: 'id,title,description,created_time,length,permalink_url,views', limit: 50 };
    if (after) params.after = after;
    const r = await graphGet(`/${pageId}/videos`, params);
    if (!r.ok) { videoErr = r.data && r.data.error; break; }
    (r.data.data || []).forEach((v) => videos.push(v));
    after = r.data.paging && r.data.paging.cursors && r.data.paging.cursors.after;
    pageN++;
  } while (after && pageN < 20);

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const shaped = videos.map((v) => ({
    id: v.id,
    title: clean(v.title) || clean(v.description).slice(0, 70),
    views: v.views || 0,
    created: (v.created_time || '').slice(0, 10),
    length_s: v.length ? Math.round(v.length) : null,
    url: v.permalink_url,
  }));
  const byViews = shaped.slice().sort((a, b) => (b.views || 0) - (a.views || 0));

  // Recent feed sample (non-video posts count)
  const posts = await graphGet(`/${pageId}/posts`, { access_token: token, fields: 'id,created_time', limit: 50 });
  const postCount = (posts.data && posts.data.data || []).length;

  return json(200, {
    ok: !!me.ok,
    page: me.ok ? { name: me.data.name, id: me.data.id, followers: me.data.followers_count || me.data.fan_count, category: me.data.category, link: me.data.link } : { error: me.data },
    vaulted_page_name: pageName,
    video_count: videos.length,
    total_views_top: byViews.reduce((s, v) => s + (v.views || 0), 0),
    videos: q.full ? byViews : byViews.slice(0, 25),
    recent_posts_sampled: postCount,
    video_error: videoErr,
  });
};
