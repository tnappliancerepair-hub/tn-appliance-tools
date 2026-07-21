// video-dub-submit — kick off a Spanish dub of a finished Studio clip. Uses the
// clip's own S3 copy as the source. The dubbed clip flows back into the queue via
// video-dub-poll. Owner-gated.
//   POST { secret, job_id, lang? }   (lang default "es")
'use strict';
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const { loadQueue, signedInlineUrl } = require('./_lib/video-queue');
const dub = require('./_lib/elevenlabs-dub');

const DUB_KEY = 'VIDEO_DUB_JOBS';
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }
async function loadDubs() { try { return JSON.parse((await getSecretFresh(DUB_KEY)) || '[]'); } catch (_) { return []; } }
async function saveDubs(j) { if (j.length > 200) j = j.slice(-200); await setSecret(DUB_KEY, JSON.stringify(j)); }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });
  if (!(await dub.configured())) return json(400, { error: 'elevenlabs_not_configured' });

  const queue = await loadQueue();
  const job = queue.find((j) => String(j.id) === String(b.job_id));
  if (!job) return json(404, { error: 'job_not_found' });
  const lang = String(b.lang || 'es').slice(0, 5);

  // Source must be a public URL ElevenLabs can fetch — use the S3 copy if hosted, else the stored url.
  let source_url = job.download_url;
  if (job.hosted && job.clip_key) { try { source_url = (await signedInlineUrl(job.clip_key)) || source_url; } catch (_) {} }
  if (!source_url) return json(400, { error: 'no_source_video' });

  const created = await dub.createDub({ source_url, target_lang: lang, source_lang: 'en', name: (job.title || 'TN Appliance').slice(0, 60) });
  if (!created.ok) return json(502, { error: 'dub_create_failed', detail: created.error || created.detail });

  const dubs = await loadDubs();
  dubs.push({ id: Date.now() + '-' + Math.floor(Math.random() * 1e6), src_job_id: job.id, title: job.title, lang, dubbing_id: created.dubbing_id, viral_score: job.viral_score || null, status: 'dubbing', created_ms: Date.now() });
  await saveDubs(dubs);
  return json(200, { ok: true, dubbing_id: created.dubbing_id, lang, note: 'Dubbing — the Spanish version lands in the queue in a few minutes.' });
};
