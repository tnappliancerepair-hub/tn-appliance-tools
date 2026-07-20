// review-card-store — hosts a rendered review-card PNG on S3 and appends it to the
// auto-post pool (vault SOCIAL_REVIEW_CARD_POOL_POSTS). The card is rendered in a
// browser (canvas) and pushed here; we store the bytes + the review meta + an LA flag
// so review-card-poster can drop one native photo post per run. Owner-gated.
//
//   POST { secret, png_base64, author, stars, text, is_la?, fmt? }  -> { ok, key, pool_size }
//   GET  ?secret=&stats=1                                           -> pool counts
//   GET  ?secret=&clear=1                                           -> empty the pool (re-seed)
'use strict';
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');

const POOL_KEY = 'SOCIAL_REVIEW_CARD_POOL_POSTS';
const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o, null, 2) }; }

async function loadPool() { try { return JSON.parse((await getSecretFresh(POOL_KEY)) || '[]'); } catch (_) { return []; } }
async function savePool(p) { await setSecret(POOL_KEY, JSON.stringify(p)); }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const secret = q.secret || (() => { try { return JSON.parse(event.body || '{}').secret; } catch (_) { return ''; } })();
  if (secret !== admin) return json(401, { error: 'unauthorized' });

  if (event.httpMethod === 'GET') {
    const pool = await loadPool();
    if (q.clear === '1') { await savePool([]); return json(200, { ok: true, cleared: true }); }
    return json(200, { ok: true, pool_size: pool.length, posted: pool.filter((x) => x.posted).length, remaining: pool.filter((x) => !x.posted).length, louisiana: pool.filter((x) => x.is_la).length });
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const b64 = String(b.png_base64 || '').replace(/^data:image\/\w+;base64,/, '');
  if (!b64) return json(400, { error: 'png_base64 required' });
  const bucket = process.env.TN_AWS_S3_BUCKET;
  if (!bucket) return json(500, { error: 's3_not_configured' });

  const buf = Buffer.from(b64, 'base64');
  const key = 'social/review-cards/' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.png';
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: 'image/png' }));
  } catch (e) { return json(502, { error: 's3_put_failed', detail: String((e && e.message) || e) }); }

  const pool = await loadPool();
  pool.push({ key, author: String(b.author || '').slice(0, 80), stars: Number(b.stars) || 5, text: String(b.text || '').slice(0, 600), is_la: !!b.is_la, tech: String(b.tech || '').slice(0, 12) || null, towns: String(b.towns || '').slice(0, 80) || null, phone: String(b.phone || '').slice(0, 20) || null, spotlight: !!b.spotlight, bio: String(b.bio || '').slice(0, 60) || null, fmt: b.fmt === 'story' ? 'story' : 'square', posted: false, added_ms: Date.now() });
  await savePool(pool);
  return json(200, { ok: true, key, size_kb: Math.round(buf.length / 1024), pool_size: pool.length });
};
