// Draft-first Facebook campaign auto-poster.
//
// TWO safety gates:
//   1) The daily cron only DRAFTS the next post — and only when SOCIAL_CAMPAIGN_LIVE=true
//      (Teddy flips that flag = GO). Until then the cron no-ops.
//   2) Nothing is ever PUBLISHED without an explicit ?action=approve (owner-gated).
//
// State lives in the vault key SOCIAL_CAMPAIGN_STATE (a small JSON blob):
//   { published:[keys], skipped:[keys], pending:{...draft} | null, log:[...] }
//
// Actions (all owner-gated except the self-authing scheduled draft):
//   ?action=list            what's drafted/published/next (review page reads this)
//   ?action=draft           create the next draft (does NOT publish) + notify
//   ?action=preview         the current pending draft
//   ?action=approve         PUBLISH the pending draft to Facebook (optional POST {message} to edit first)
//   ?action=skip            drop the pending draft, advance
//   ?action=reset           clear all state (testing)
'use strict';

const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const { PLAN } = require('./_lib/social-campaign-plan');
const { variantsFor } = require('./_lib/social-variants');
const { graphGet } = require('./_lib/social-fb');

const STATE_KEY = 'SOCIAL_CAMPAIGN_STATE';
const REVIEW_URL = 'https://tnapplianceexchange.net/social-drafts.html';

function json(code, obj) { return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj, null, 2) }; }

async function loadState() {
  let s = {};
  try { s = JSON.parse((await getSecretFresh(STATE_KEY)) || '{}'); } catch (_) { s = {}; }
  s.published = s.published || [];
  s.skipped = s.skipped || [];
  s.pending = s.pending || null;
  s.log = s.log || [];
  return s;
}
async function saveState(s) { if (s.log.length > 40) s.log = s.log.slice(-40); await setSecret(STATE_KEY, JSON.stringify(s)); }

function nextPlanItem(s) {
  return PLAN.find((p) => !s.published.includes(p.key) && !s.skipped.includes(p.key)) || null;
}

async function fbEdge(pageId, edge, body) {
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${pageId}/${edge}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    return { ok: r.ok && !!d.id, id: d.id, err: d.error };
  } catch (e) { return { ok: false, err: String(e.message || e) }; }
}

// A FB video permalink -> its direct source mp4, so we can re-post it NATIVELY
// (plays inline in the feed) instead of as a buried gray link preview.
async function resolveVideoSource(link, token) {
  const m = String(link || '').match(/\/(?:videos|reel)\/(\d+)/);
  if (!m) return null;
  try { const r = await graphGet(`/${m[1]}`, { fields: 'source', access_token: token }); return (r && r.data && r.data.source) || null; }
  catch (_) { return null; }
}

// Media-aware publish. Native photo > native video > text/link. Native media gets
// ~2-3x the organic reach of a text or link-preview post — the whole point of
// "aggressive." Each branch falls through to a weaker one on failure so a post
// never silently fails to go out. (Teddy 2026-07-20)
async function publishToFB(pageId, token, item, message) {
  // 1) native PHOTO (branded review card / real job pic) — needs a hosted image URL
  if (item.image_url) {
    const r = await fbEdge(pageId, 'photos', { url: item.image_url, message, access_token: token });
    if (r.ok) return { ...r, as: 'photo' };
  }
  // 2) native VIDEO — re-upload the archive clip's source so it plays inline
  if (item.kind === 'video' && item.link) {
    const src = await resolveVideoSource(item.link, token);
    if (src) {
      const r = await fbEdge(pageId, 'videos', { file_url: src, description: message, access_token: token });
      if (r.ok) return { ...r, as: 'video' };
    }
  }
  // 3) text (+ optional link) — the fallback
  const body = { message, access_token: token };
  if (item.link) body.link = item.link;
  const r = await fbEdge(pageId, 'feed', body);
  return { ...r, as: item.link ? 'link' : 'text' };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false;
  try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const action = q.action || (scheduled ? 'draft' : 'list');
  const authed = q.secret === admin;
  if (!authed && !(scheduled && action === 'draft')) return json(401, { error: 'unauthorized' });

  const s = await loadState();
  const remaining = PLAN.filter((p) => !s.published.includes(p.key) && !s.skipped.includes(p.key)).length;
  const liveFlag = String(await getSecret('SOCIAL_CAMPAIGN_LIVE') || '').toLowerCase() === 'true';

  if (action === 'list') {
    return json(200, {
      ok: true, live: liveFlag,
      total: PLAN.length, published: s.published, skipped: s.skipped, remaining,
      pending: s.pending, next_up: s.pending ? null : nextPlanItem(s),
      variants: s.pending ? variantsFor(s.pending) : null,
      recent: s.log.slice(-14).reverse(),
      review_url: REVIEW_URL,
    });
  }

  if (action === 'draft') {
    // scheduled auto-draft self-gates on the LIVE flag; manual (secret) draft always allowed
    if (scheduled && !liveFlag) return json(200, { ok: true, skipped: 'SOCIAL_CAMPAIGN_LIVE not true — cron idle' });
    if (s.pending) return json(200, { ok: true, already_pending: true, pending: s.pending, note: 'approve or skip the current draft first' });
    const item = nextPlanItem(s);
    if (!item) return json(200, { ok: true, done: true, message: 'campaign queue exhausted 🎉' });
    s.pending = { key: item.key, kind: item.kind, title: item.title, message: item.message, link: item.link || null, note: item.note || null, drafted_at: Date.now() };
    await saveState(s);
    return json(200, { ok: true, drafted: s.pending, variants: variantsFor(s.pending), review_url: REVIEW_URL });
  }

  if (action === 'preview') return json(200, { ok: true, pending: s.pending, variants: s.pending ? variantsFor(s.pending) : null, next_up: s.pending ? null : nextPlanItem(s) });

  if (action === 'skip') {
    if (!s.pending) return json(200, { ok: false, error: 'no pending draft' });
    const key = s.pending.key;
    s.skipped.push(key);
    s.log.push({ key, title: s.pending.title, action: 'skipped', at: Date.now() });
    s.pending = null;
    await saveState(s);
    return json(200, { ok: true, skipped: key });
  }

  if (action === 'approve') {
    if (!authed) return json(401, { error: 'unauthorized' });
    if (!s.pending) return json(200, { ok: false, error: 'no pending draft to approve' });
    const item = s.pending;
    const token = await getSecret('SOCIAL_FB_PAGE_TOKEN');
    const pageId = await getSecret('SOCIAL_FB_PAGE_ID');
    if (!token || !pageId) return json(400, { error: 'not connected — run social-fb-oauth-start first' });
    let message = item.message;
    if (q.message != null) message = q.message;
    else if (event.body) { try { const b = JSON.parse(event.body); if (b.message != null) message = b.message; } catch (_) {} }
    const pub = await publishToFB(pageId, token, item, message);
    if (!pub.ok) return json(502, { ok: false, error: 'publish failed', detail: pub.err });
    const key = item.key;
    s.published.push(key);
    s.log.push({ key, title: item.title, action: 'published', fb_post_id: pub.id, posted_as: pub.as, at: Date.now() });

    // Best-effort Instagram cross-post. IG can't post text-only, and video Reels
    // process async — so for VIDEO posts we hand off to a background function.
    let ig = { queued: false, reason: null };
    try {
      const igId = await getSecret('SOCIAL_IG_USER_ID');
      const m = (item.link || '').match(/\/(?:videos|reel)\/(\d+)/);
      if (!igId) ig.reason = 'instagram_not_connected';
      else if (!m) ig.reason = 'text_or_link_post — paste the Instagram copy';
      else {
        const igCap = ((variantsFor(item) || {}).instagram || {}).text || message;
        fetch('https://tnapplianceexchange.net/.netlify/functions/social-ig-crosspost-background', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, title: item.title, videoId: m[1], caption: igCap }),
        }).catch(() => {});
        ig.queued = true;
      }
    } catch (_) { ig.reason = 'error'; }

    s.pending = null;
    await saveState(s);
    return json(200, { ok: true, published: key, posted_as: pub.as, fb_post_id: pub.id, url: `https://www.facebook.com/${pub.id}`, instagram: ig });
  }

  if (action === 'reset') {
    if (!authed) return json(401, { error: 'unauthorized' });
    await saveState({ published: [], skipped: [], pending: null, log: [] });
    return json(200, { ok: true, reset: true });
  }

  return json(400, { error: 'unknown action', actions: ['list', 'draft', 'preview', 'approve', 'skip', 'reset'] });
};
