// web-push-register — a device subscribes to notifications. Stores the push
// subscription per user (role + uid) in event_log; web-push-send reads it.
//
//   POST { role, uid, subscription }   role = 'tech'|'office'|'owner'
//   -> { ok }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const role = String(b.role || 'tech').toLowerCase();
  const uid = parseInt(b.uid, 10) || 0;
  const sub = b.subscription;
  if (!sub || !sub.endpoint) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'subscription required' }) };
  try {
    await crud.logEvent('web_push_sub', { role, uid, endpoint: sub.endpoint, sub: JSON.stringify(sub), at_ms: Date.now() });
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, role, uid }) };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
