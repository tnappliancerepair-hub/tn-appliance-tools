// post-everywhere — the ONE-APPROVE fan-out. Given a finished clip it (1) writes an
// HONEST title/description grounded in the clip's REAL content (its enrichment hooks +
// payoff — no more wrong-title guesses), (2) posts to every auto platform (Facebook + IG
// live, TikTok + YouTube to drafts) via video-post, and (3) returns the one-tap publish
// links + the X/Truth paste copy — all in a single call. Texts the owner a summary.
// Owner-gated.  POST { secret, job_id, caption?, dry_run? }
'use strict';
const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const brands = require('./_lib/brands');
const SITE = 'https://tnapplianceexchange.net';
const OWNER = '+16154855795';
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

function guessAppliance(s) {
  s = String(s || '').toLowerCase();
  for (const [re, a] of [[/dryer/, 'dryer'], [/washer|washing/, 'washer'], [/fridge|refriger|freezer|ice ?maker/, 'refrigerator'], [/dishwasher/, 'dishwasher'], [/oven|range|stove|cooktop/, 'oven']]) if (re.test(s)) return a;
  return '';
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });
  if (!b.job_id) return json(400, { error: 'job_id required' });

  let queue = []; try { queue = JSON.parse((await getSecretFresh('VIDEO_STUDIO_QUEUE')) || '[]'); } catch (_) {}
  const job = queue.find((j) => String(j.id) === String(b.job_id));
  if (!job) return json(404, { error: 'job_not_found' });

  // Brand-layer safety: every auto surface (Facebook/IG/TikTok/YouTube) is wired to the
  // TN Appliance accounts. A clip that belongs to a DIFFERENT channel (Dish Guy, etc.)
  // must NEVER post here — it would land on the wrong brand's accounts. Refuse hard until
  // that channel's own accounts are connected.
  const chan = brands.get(job.channel || 'tn_appliance');
  if (chan && chan.connected === false) {
    return json(200, { ok: false, error: 'channel_not_connected', channel: chan.key, label: chan.label,
      note: `${chan.label} has no connected accounts — download the clip and post it by hand so it never goes to TN Appliance's accounts.` });
  }

  // Ground the SEO in the clip's REAL content — the enrichment hooks + payoff describe
  // what actually happens on screen, so the title comes out honest, not a blind guess.
  const notes = [job.title, job.hook_middle, job.hook_payoff, ...(Array.isArray(job.hooks) ? job.hooks : [])].filter(Boolean).join(' — ').slice(0, 1500);
  const appliance = guessAppliance(job.title + ' ' + notes + ' ' + (job.content_type || ''));
  let seo = { titles: [job.title], description: '', tags: [], hashtags: [] };
  try {
    const r = await fetch(`${SITE}/.netlify/functions/youtube-seo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: admin, title: job.title || 'TN Appliance clip', transcript: notes, appliance }) });
    const d = await r.json(); if (d && d.ok && Array.isArray(d.titles) && d.titles.length) seo = d;
  } catch (_) {}
  const honestTitle = (seo.titles && seo.titles[0]) || job.title;
  const honestDesc = seo.description || '';

  if (b.dry_run) {
    return json(200, { ok: true, dry_run: true, job: { id: job.id, title: job.title }, honest_title: honestTitle, honest_description: honestDesc, appliance, grounded_from: notes.slice(0, 200), would_post: ['facebook', 'instagram', 'tiktok', 'youtube'] });
  }

  let post = {};
  try {
    const vpBody = { secret: admin, job_id: job.id, caption: (b.caption || honestTitle), youtube_title: honestTitle, youtube_description: honestDesc };
    if (Array.isArray(b.platforms) && b.platforms.length) vpBody.platforms = b.platforms;
    const r = await fetch(`${SITE}/.netlify/functions/video-post`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(vpBody) });
    post = await r.json();
  } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
  const res = (post && post.results) || {};
  const ytId = res.youtube && res.youtube.ok && res.youtube.video_id;

  const bundle = {
    auto: { facebook: res.facebook || { ok: false }, instagram: res.instagram || { ok: false } },
    one_tap: {
      youtube: ytId ? { status: 'uploaded_private', publish_here: `https://studio.youtube.com/video/${ytId}/edit`, note: 'open → Visibility → Public → Save' } : (res.youtube || { ok: false }),
      tiktok: res.tiktok && res.tiktok.ok ? { status: 'in_drafts', note: 'open TikTok app → Inbox → Post' } : (res.tiktok || { ok: false }),
    },
    paste: { x: (post && post.paste && post.paste.x) || honestTitle, truthsocial: (post && post.paste && post.paste.truthsocial) || honestTitle },
    honest_title: honestTitle,
  };

  try {
    const live = [res.facebook && res.facebook.ok && 'Facebook', res.instagram && res.instagram.ok && 'Instagram'].filter(Boolean).join(' + ');
    const lines = [`🚀 "${honestTitle}"`,
      live ? `✅ Live now: ${live}` : '',
      ytId ? `▶️ YouTube — tap to publish: https://studio.youtube.com/video/${ytId}/edit` : '',
      res.tiktok && res.tiktok.ok ? '🎵 TikTok — in your drafts, tap Post' : '',
      '✍️ X + Truth Social copy is in the studio.'].filter(Boolean);
    await sendSms(OWNER, lines.join('\n'), 'owner', 'post_everywhere');
  } catch (_) {}

  return json(200, { ok: true, job_id: job.id, bundle });
};
