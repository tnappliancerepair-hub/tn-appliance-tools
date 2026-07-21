// video-dub-poll — ElevenLabs dubbing is async, so we poll. When a dub is done we
// download it, faststart it, host it on S3, and drop it into the Studio queue as a
// Spanish clip ready to post. Cron + manual. Owner-gated for manual runs.
//   GET ?secret=<VAPI_ADMIN_SECRET>   |   scheduled (cron)
'use strict';
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const { loadQueue, saveQueue } = require('./_lib/video-queue');
const { faststart } = require('./_lib/faststart');
const dub = require('./_lib/elevenlabs-dub');
const crud = require('./_lib/xano/metadata-crud');

const DUB_KEY = 'VIDEO_DUB_JOBS';
const MAX_AGE_MS = 3 * 3600 * 1000;
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }
async function loadDubs() { try { return JSON.parse((await getSecretFresh(DUB_KEY)) || '[]'); } catch (_) { return []; } }
async function saveDubs(j) { await setSecret(DUB_KEY, JSON.stringify(j)); }

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (!scheduled && q.secret !== admin) return json(401, { error: 'unauthorized' });
  if (!(await dub.configured())) return json(200, { ok: true, skipped: 'not_configured' });

  const dubs = await loadDubs();
  const pending = dubs.filter((d) => d.status === 'dubbing');
  if (!pending.length) return json(200, { ok: true, pending: 0 });

  const bucket = process.env.TN_AWS_S3_BUCKET;
  const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });
  const out = [];
  for (const d of pending) {
    if (Date.now() - d.created_ms > MAX_AGE_MS) { d.status = 'timeout'; out.push({ id: d.id, timeout: true }); continue; }
    const st = await dub.getStatus(d.dubbing_id);
    if (!st.ok) { out.push({ id: d.id, error: st.error }); continue; }
    if (st.status === 'failed') { d.status = 'failed'; out.push({ id: d.id, failed: true }); continue; }
    if (st.status !== 'dubbed') { out.push({ id: d.id, still: st.status }); continue; }

    const dl = await dub.download(d.dubbing_id, d.lang);
    if (!dl.ok) { out.push({ id: d.id, error: 'download_failed' }); continue; }
    const buf = faststart(dl.buffer);
    const key = 'social/clips/dub-' + d.id + '.mp4';
    try { await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: 'video/mp4' })); }
    catch (e) { out.push({ id: d.id, error: 's3_failed' }); continue; }

    const queue = await loadQueue();
    const jid = 'dub-' + d.id;
    queue.push({
      id: jid, s3_key: null, title: (d.title || 'TN Appliance') + ' (Español)', hook: '',
      content_type: 'dub_' + d.lang, template: 'dub', language: d.lang, source: 'dub-' + d.lang,
      viral_score: d.viral_score || null, submagic_id: null,
      status: 'ready', download_url: null, clip_key: key, hosted: true, faststart: true,
      created_ms: Date.now(), ready_ms: Date.now(), posted: {},
    });
    await saveQueue(queue);
    d.status = 'done'; d.clip_key = key;
    out.push({ id: d.id, done: true });
    try { await crud.logEvent('video_dub_done', { dub_id: d.id, lang: d.lang, at_ms: Date.now() }); } catch (_) {}
  }
  await saveDubs(dubs);
  return json(200, { ok: true, processed: out });
};
