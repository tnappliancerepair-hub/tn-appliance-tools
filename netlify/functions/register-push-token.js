// register-push-token — the native app calls this on launch with its push
// token so we can send the tech notifications. Stored in event_log; send-push
// reads the latest token per tech.
//
//   POST { tech_id, token, platform }   platform = 'ios' | 'android'
//   -> { ok }
'use strict';
const crud = require('./_lib/xano/metadata-crud');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const techId = parseInt(b.tech_id, 10) || 0;
  const token = String(b.token || '').trim();
  const platform = String(b.platform || '').toLowerCase() === 'ios' ? 'ios' : 'android';
  if (!techId || !token) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'tech_id + token required' }) };
  try {
    await crud.logEvent('push_token', { tech_id: techId, token, platform, at_ms: Date.now() });
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, tech_id: techId, platform }) };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
