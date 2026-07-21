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
  const queue = await loadQueue();
  const todo = queue.filter((j) => j.status === 'ready' && (force || !j.enriched)).slice(0, max);

  let done = 0, failed = 0;
  for (const job of todo) {
    // good-ol-days archive clips get a nostalgia character nudge for the hooks
    const character = (job.source === 'fb-archive') ? 'the old TN Appliance shop days — the good ol days crew, real junk men, genuine and funny' : '';
    const title = job.title || 'TN Appliance clip';
    const hook = await post('hook-doctor', { secret: admin, title, character });
    await sleep(400);
    const seo = await post('youtube-seo', { secret: admin, title, is_long: false });
    await sleep(400);
    if (hook && hook.ok) { job.hooks = hook.hooks; job.hook_middle = hook.middle; job.hook_payoff = hook.payoff; job.hook_notes = hook.notes; }
    if (seo && seo.ok) { job.seo = { titles: seo.titles, description: seo.description, tags: seo.tags, hashtags: seo.hashtags }; }
    if ((hook && hook.ok) || (seo && seo.ok)) { job.enriched = true; done++; } else { failed++; }
  }
  if (done) await saveQueue(queue);
  return json(200, { ok: true, enriched: done, failed, remaining: queue.filter((j) => j.status === 'ready' && !j.enriched).length });
};
