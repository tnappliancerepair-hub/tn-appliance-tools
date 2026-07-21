// fb-archive-import-background — pulls the golden-era videos off the TN Appliance
// Facebook Page, faststarts each, and hosts it on our own S3 so it plays instantly
// in the Studio and never expires. Background fn (15-min budget) — fetches the FB
// source (short-lived CDN url) and downloads it in the SAME run so the url can't
// expire on us. Idempotent: dedupes by FB video id, deterministic S3 key.
//   POST { secret } | { internal:true }  [ &before=2017-01-01 &all=1 &max=40 ]
'use strict';
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const { graphGet } = require('./_lib/social-fb');
const { faststart } = require('./_lib/faststart');
const crud = require('./_lib/xano/metadata-crud');

const QUEUE_KEY = 'VIDEO_STUDIO_QUEUE';
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }; }
async function loadQueue() { try { return JSON.parse((await getSecretFresh(QUEUE_KEY)) || '[]'); } catch (_) { return []; } }
async function saveQueue(q) { if (q.length > 400) q = q.slice(-400); await setSecret(QUEUE_KEY, JSON.stringify(q)); }

exports.handler = async function (event) {
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin && b.secret !== admin && !b.internal) return json(401, { error: 'unauthorized' });

  const token = await getSecret('SOCIAL_FB_PAGE_TOKEN');
  const pageId = await getSecret('SOCIAL_FB_PAGE_ID');
  if (!token || !pageId) return json(400, { error: 'fb_page_not_connected' });
  const bucket = process.env.TN_AWS_S3_BUCKET;
  if (!bucket) return json(500, { error: 's3_not_configured' });
  const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });

  const all = q.all === '1' || b.all === true;
  const before = String(q.before || b.before || '2017-01-01'); // golden era = pre-2017 by default
  const cutMs = Date.parse(before + 'T00:00:00Z');
  const max = Math.min(parseInt(q.max || b.max, 10) || 40, 60);

  // Pull the page's videos (one page of 50 covers the whole archive).
  const r = await graphGet('/' + pageId + '/videos', {
    access_token: token,
    fields: 'id,title,description,created_time,length,permalink_url,source',
    limit: 50,
  });
  if (!r.ok) return json(502, { error: 'fb_videos_failed', detail: (r.data && r.data.error && r.data.error.message) || r.status });
  let vids = (r.data && r.data.data) || [];

  // golden-era filter (unless all=1), oldest first
  vids = vids
    .filter((v) => v.source)
    .filter((v) => all || (v.created_time && Date.parse(v.created_time) < cutMs))
    .sort((a, c) => String(a.created_time || '').localeCompare(String(c.created_time || '')))
    .slice(0, max);

  const queue = await loadQueue();
  const have = new Set(queue.map((j) => j.fb_id).filter(Boolean));

  let imported = 0, skipped = 0, failed = 0;
  const landed = [];
  for (const v of vids) {
    if (have.has(v.id)) { skipped++; continue; }
    try {
      const resp = await fetch(v.source);
      if (!resp.ok) { failed++; continue; }
      let buf = Buffer.from(await resp.arrayBuffer());
      if (!buf.length) { failed++; continue; }
      buf = faststart(buf); // moov to the front → instant mobile playback
      const key = 'social/clips/fbarch-' + v.id + '.mp4';
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: 'video/mp4' }));
      const title = String(v.title || v.description || 'TN Appliance — good ol days').slice(0, 100);
      const job = {
        id: 'fbarch-' + v.id, fb_id: v.id, title,
        hook: '', content_type: 'goodol', template: 'archive', language: 'en',
        source: 'fb-archive', viral_score: null, submagic_id: null,
        status: 'ready', clip_key: key, hosted: true, faststart: true,
        download_url: v.source, permalink: v.permalink_url || null,
        created_time: v.created_time || null, created_ms: Date.now(), ready_ms: Date.now(), posted: {},
      };
      queue.push(job);
      have.add(v.id);
      imported++;
      landed.push({ title, when: (v.created_time || '').slice(0, 10) });
    } catch (_) { failed++; }
  }
  if (imported) await saveQueue(queue);
  try { await crud.logEvent('fb_archive_imported', { imported, skipped, failed, at_ms: Date.now() }); } catch (_) {}
  // punch up the freshly-imported clips (hooks + SEO) hands-off
  if (imported) { try { fetch('https://tnapplianceexchange.net/.netlify/functions/video-enrich-background', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ internal: true }) }).catch(() => {}); } catch (_) {} }
  return json(200, { ok: true, imported, skipped, failed, landed });
};
