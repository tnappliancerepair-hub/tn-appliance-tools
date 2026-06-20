// web-push-send — send a notification to a user's device(s) via Web Push.
// Works on Android Chrome, desktop Chrome/Edge/Safari, and iOS 16.4+ (when the
// app is added to the home screen). Free, no app store, no carrier.
//
//   POST { role?, uid?, tech_id?, title, body, url? }
//   -> { ok, sent, devices }
'use strict';
const webpush = require('web-push');
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const EVENT_LOG = 3;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

function meta(r) { let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  let role = String(b.role || '').toLowerCase();
  let uid = parseInt(b.uid, 10) || 0;
  if (!role && b.tech_id) { role = 'tech'; uid = parseInt(b.tech_id, 10) || 0; }
  const title = String(b.title || 'Ant 🐜').slice(0, 120);
  const body = String(b.body || '').slice(0, 300);
  const url = String(b.url || (role === 'tech' ? '/tech.html' : '/office-messages.html'));
  if (!body) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'body required' }) };

  const [pub, priv] = await Promise.all([getSecret('VAPID_PUBLIC_KEY'), getSecret('VAPID_PRIVATE_KEY')]);
  if (!pub || !priv) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, configured: false }) };
  webpush.setVapidDetails('mailto:tnappliancerepair@gmail.com', pub, priv);

  // gather this user's subscriptions (latest per endpoint) minus pruned ones
  let subRows = [], goneRows = [];
  try {
    [subRows, goneRows] = await Promise.all([
      crud.searchPage(EVENT_LOG, { action: 'web_push_sub' }, { created_at: 'desc' }, 300),
      crud.searchPage(EVENT_LOG, { action: 'web_push_sub_gone' }, { created_at: 'desc' }, 300),
    ]);
  } catch (_) {}
  const gone = new Set(goneRows.map((r) => meta(r).endpoint).filter(Boolean));
  const seen = new Set(); const subs = [];
  for (const r of subRows) {
    const m = meta(r);
    if (m.role !== role || Number(m.uid) !== uid) continue;
    if (!m.endpoint || seen.has(m.endpoint) || gone.has(m.endpoint)) continue;
    seen.add(m.endpoint);
    try { subs.push(JSON.parse(m.sub)); } catch (_) {}
  }
  if (!subs.length) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, sent: 0, devices: 0, note: 'no_subscription' }) };

  const payload = JSON.stringify({ title, body, url });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification(s, payload); sent++; }
    catch (e) {
      const sc = e && e.statusCode;
      if (sc === 404 || sc === 410) { try { await crud.logEvent('web_push_sub_gone', { endpoint: s.endpoint, at_ms: Date.now() }); } catch (_) {} }
    }
  }));
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, sent, devices: subs.length }) };
};
