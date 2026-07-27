// stream-status — tell the Teddy Tool the REAL state of a Cloudflare Stream video so a
// clip that didn't finish encoding stops showing as an opaque black "An unknown error
// occurred" box. For each cfstream uid it returns the Stream API's status.state
// (ready / inprogress / queued / pendingupload / error), readyToStream, %complete, the
// error reason, and whether the video requires signed URLs (can't embed publicly).
//
//   GET  ?uids=uid1,uid2   |   POST { uids:"uid1,uid2" | ["uid1","uid2"] }
//     -> { ok, videos: { uid: { state, ready, pct, reason, requireSignedURLs, duration } } }
//   -> { ok:false, error:'stream_not_configured' } when Cloudflare creds aren't set.
'use strict';
const { getSecret } = require('./_lib/secrets');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
function json(c, o) { return { statusCode: c, headers: CORS, body: JSON.stringify(o) }; }
// uids are opaque alnum ids; strip the cfstream: marker and anything non-alnum.
function cleanUid(u) { return String(u == null ? '' : u).replace(/^cfstream:/, '').replace(/[^0-9a-zA-Z]/g, '').slice(0, 64); }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  let uids = q.uids || b.uids || q.uid || b.uid || '';
  if (Array.isArray(uids)) uids = uids.join(',');
  const seen = {};
  const list = String(uids).split(',').map(cleanUid).filter((u) => u && !seen[u] && (seen[u] = 1)).slice(0, 20);
  if (!list.length) return json(400, { ok: false, error: 'uids required' });

  const acct = await getSecret('CLOUDFLARE_ACCOUNT_ID');
  const token = await getSecret('CLOUDFLARE_STREAM_TOKEN');
  if (!acct || !token) return json(200, { ok: false, error: 'stream_not_configured' });

  const videos = {};
  await Promise.all(list.map(async (uid) => {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/stream/${uid}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d || !d.success || !d.result) {
        videos[uid] = { state: 'not_found', ready: false, http: r.status, reason: (d && d.errors && d.errors[0] && d.errors[0].message) || 'not found on Cloudflare Stream' };
        return;
      }
      const v = d.result;
      const st = v.status || {};
      videos[uid] = {
        state: st.state || (v.readyToStream ? 'ready' : 'unknown'),
        ready: !!v.readyToStream,
        pct: (st.pctComplete != null && st.pctComplete !== '') ? Number(st.pctComplete) : null,
        reason: st.errorReasonText || st.errorReasonCode || '',
        requireSignedURLs: !!v.requireSignedURLs,
        duration: (v.duration != null ? v.duration : null),
      };
    } catch (e) {
      videos[uid] = { state: 'error', ready: false, reason: String((e && e.message) || e) };
    }
  }));

  return json(200, { ok: true, videos });
};
