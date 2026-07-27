// video-enrich-background — runs the Hook Doctor + YouTube SEO across every clip
// in the Studio that hasn't been punched up yet, and stores the result ON the job
// so the cockpit shows hooks + SEO inline (no per-clip tapping). Background fn
// (15-min budget). Idempotent: only touches clips missing `enriched`.
//   POST { secret } | { internal:true }  [ &force=1 &max=40 ]
'use strict';
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');

const QUEUE_KEY = 'VIDEO_STUDIO_QUEUE';
const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }; }
async function loadQueue() { try { return JSON.parse((await getSecretFresh(QUEUE_KEY)) || '[]'); } catch (_) { return []; } }
async function saveQueue(q) { if (q.length > 400) q = q.slice(-400); await setSecret(QUEUE_KEY, JSON.stringify(q)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(fn, body) {
  try {
    const r = await fetch(BASE + '/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

exports.handler = async function (event) {
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin && b.secret !== admin && !b.internal) return json(401, { error: 'unauthorized' });

  const force = q.force === '1' || b.force === true;
  const max = Math.min(parseInt(q.max || b.max, 10) || 40, 60);
  const first = await loadQueue();
  const todo = first.filter((j) => j.status === 'ready' && (force || !j.enriched)).map((j) => j.id).slice(0, max);

  // Merge one clip's enrichment onto the CURRENT queue (re-loaded), so concurrent
  // posts/imports are never clobbered. Save right after — live progress + crash-safe.
  async function persist(id, patch) {
    const cur = await loadQueue();
    const t = cur.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch, { enriched: true });
    await saveQueue(cur);
  }

  let done = 0, failed = 0;
  for (const id of todo) {
    const src = first.find((x) => x.id === id) || {};
    const character = (src.source === 'fb-archive') ? 'the old TN Appliance shop days — the good ol days crew, real junk men, genuine and funny' : '';
    const title = src.title || 'TN Appliance clip';
    // Series-aware + data-grounded: pass the clip's series + appliance/brand/model so
    // the hook engine writes in the right franchise flavor and grounds the stat hook.
    const hook = await post('hook-doctor', {
      secret: admin, title, character,
      series: src.series || src.content_type, appliance: src.appliance || '',
      brand: src.brand || '', model: src.model || '', symptom: src.symptom || '',
      channel: src.channel || 'tn_appliance',
    });
    await sleep(300);
    const seo = await post('youtube-seo', { secret: admin, title, is_long: false });
    await sleep(300);
    const patch = {};
    if (hook && hook.ok) {
      patch.hooks = hook.hooks; patch.hook_formats = hook.hook_formats; patch.on_screen_hook = hook.on_screen_hook;
      patch.proof_line = hook.proof_line; patch.hook_middle = hook.middle; patch.hook_payoff = hook.payoff;
      patch.hook_notes = hook.notes; patch.series = hook.series; patch.facts = hook.facts; patch.title_suggestions = hook.title_suggestions;
    }
    if (seo && seo.ok) { patch.seo = { titles: seo.titles, description: seo.description, tags: seo.tags, hashtags: seo.hashtags }; }
    if (Object.keys(patch).length) { await persist(id, patch); done++; } else { failed++; }
  }
  const rem = (await loadQueue()).filter((j) => j.status === 'ready' && !j.enriched).length;
  return json(200, { ok: true, enriched: done, failed, remaining: rem });
};
