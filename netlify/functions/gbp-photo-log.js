// gbp-photo-log — records a GBP (Google Business Profile) photo a tech just
// uploaded via gbp-photos.html, and texts Teddy (throttled) that fresh photos
// are ready to post. The photo itself is already in S3 (uploaded via the
// reliable photo-upload function); this just tags it as a GBP photo in event_log
// so the review gallery + the once-a-day "ready to post" nudge can find it.
//
//   POST { s3_key, tech_id?, caption? }  ->  { ok }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');

const EVENT_LOG = 3;
const OWNER = '+16154855795';
const REVIEW_URL = 'https://tnapplianceexchange.net/gbp-photos-review.html';
const NOTIFY_THROTTLE_MS = 3 * 60 * 60 * 1000; // text Teddy at most once / 3h

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const s3Key = String(b.s3_key || '').trim();
  if (!s3Key) return json(400, { ok: false, error: 's3_key required' });
  const techId = b.tech_id != null ? parseInt(String(b.tech_id).replace(/\D/g, ''), 10) || null : null;

  // 1. tag it as a GBP photo
  try {
    await crud.insert(EVENT_LOG, { action: 'gbp_photo', metadata: { s3_key: s3Key, tech_id: techId, caption: String(b.caption || '').slice(0, 200), at_ms: Date.now() } });
  } catch (_) { /* best-effort; don't fail the upload over the tag */ }

  // 2. nudge Teddy, throttled — one "photos are coming in, go post them" text per 3h
  try {
    const last = await crud.searchOne(EVENT_LOG, { action: 'gbp_photo_notify' }, { id: 'desc' });
    let lastAt = 0;
    if (last) { let m = last.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } lastAt = (m && m.at_ms) || 0; }
    if (Date.now() - lastAt > NOTIFY_THROTTLE_MS) {
      await sendSms(OWNER, '[ant] 📸 Fresh job photos coming in from the crew for your Google profile. Review + download to post: ' + REVIEW_URL, 'owner', 'gbp_photo_log');
      await crud.insert(EVENT_LOG, { action: 'gbp_photo_notify', metadata: { at_ms: Date.now() } });
    }
  } catch (_) {}

  return json(200, { ok: true });
};
