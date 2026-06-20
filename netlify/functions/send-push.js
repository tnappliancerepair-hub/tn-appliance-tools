// send-push — send a native push to a tech (the free, can't-ignore replacement
// for SMS). Reads keys from the runtime vault, so it stays dormant (returns
// {configured:false}) until you add them — no errors before the app ships.
//
//   POST { tech_id?, token?, platform?, title, body, data? }
//   -> { ok, sent, channel } | { ok:false, configured:false }
//
// Keys (set via admin-secrets.html → vault):
//   Android (FCM legacy):  FCM_SERVER_KEY
//   iOS (APNs):  APNS_KEY_P8 (the .p8 contents), APNS_KEY_ID, APNS_TEAM_ID,
//                APNS_BUNDLE_ID  (defaults to com.tnappliance.antfield)
'use strict';
const crypto = require('crypto');
const http2 = require('http2');
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const EVENT_LOG = 3;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

// latest registered token for a tech
async function tokenForTech(techId) {
  const rows = await crud.searchPage(EVENT_LOG, { action: 'push_token' }, { created_at: 'desc' }, 200);
  for (const r of rows) {
    let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    if (m && Number(m.tech_id) === techId && m.token) return { token: m.token, platform: m.platform || 'android' };
  }
  return null;
}

async function sendFCM(serverKey, token, title, body, data) {
  const res = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: { Authorization: 'key=' + serverKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: token, priority: 'high', notification: { title, body, sound: 'default' }, data: data || {} }),
  });
  const txt = await res.text();
  return { ok: res.ok, status: res.status, body: txt.slice(0, 300) };
}

function apnsJwt(p8, keyId, teamId) {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const signer = crypto.createSign('SHA256');
  signer.update(header + '.' + claims);
  const sig = signer.sign({ key: p8, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return header + '.' + claims + '.' + sig;
}

function sendAPNs(p8, keyId, teamId, bundleId, token, title, body, data) {
  return new Promise((resolve) => {
    let jwt;
    try { jwt = apnsJwt(p8, keyId, teamId); } catch (e) { return resolve({ ok: false, status: 0, body: 'jwt_error: ' + e.message }); }
    const client = http2.connect('https://api.push.apple.com');
    client.on('error', (e) => resolve({ ok: false, status: 0, body: 'conn_error: ' + e.message }));
    const payload = JSON.stringify({ aps: { alert: { title, body }, sound: 'default', badge: 1 }, data: data || {} });
    const req = client.request({
      ':method': 'POST', ':path': '/3/device/' + token,
      authorization: 'bearer ' + jwt, 'apns-topic': bundleId, 'apns-push-type': 'alert', 'content-type': 'application/json',
    });
    let status = 0, chunks = '';
    req.on('response', (h) => { status = h[':status']; });
    req.on('data', (d) => { chunks += d; });
    req.on('end', () => { client.close(); resolve({ ok: status === 200, status, body: chunks.slice(0, 300) }); });
    req.on('error', (e) => { try { client.close(); } catch (_) {} resolve({ ok: false, status: 0, body: 'req_error: ' + e.message }); });
    req.end(payload);
  });
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const title = String(b.title || 'Ant 🐜').slice(0, 120);
  const body = String(b.body || '').slice(0, 300);
  if (!body) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'body required' }) };

  // resolve target token + platform
  let token = String(b.token || '').trim();
  let platform = String(b.platform || '').toLowerCase();
  if (!token && b.tech_id) {
    const t = await tokenForTech(parseInt(b.tech_id, 10) || 0).catch(() => null);
    if (t) { token = t.token; platform = platform || t.platform; }
  }
  if (!token) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'no_token_for_tech' }) };

  try {
    if (platform === 'ios') {
      const [p8, keyId, teamId, bundleId] = await Promise.all([
        getSecret('APNS_KEY_P8'), getSecret('APNS_KEY_ID'), getSecret('APNS_TEAM_ID'), getSecret('APNS_BUNDLE_ID'),
      ]);
      if (!p8 || !keyId || !teamId) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, configured: false, channel: 'apns' }) };
      const r = await sendAPNs(p8, keyId, teamId, bundleId || 'com.tnappliance.antfield', token, title, body, b.data);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: r.ok, sent: r.ok, channel: 'apns', status: r.status }) };
    }
    const serverKey = await getSecret('FCM_SERVER_KEY');
    if (!serverKey) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, configured: false, channel: 'fcm' }) };
    const r = await sendFCM(serverKey, token, title, body, b.data);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: r.ok, sent: r.ok, channel: 'fcm', status: r.status }) };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
