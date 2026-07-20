// youtube-check — owner-gated connection check. Confirms YouTube is wired and
// shows which channel is connected.  GET ?secret=<VAPI_ADMIN_SECRET>
'use strict';
const { getSecret } = require('./_lib/secrets');
const yt = require('./_lib/youtube');

function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { error: 'unauthorized' });
  const ch = await yt.getChannel();
  if (!ch.ok) {
    if (ch.configured === false) return json(200, { connected: false, missing: ch.missing, note: 'Do the one console step + open /.netlify/functions/youtube-oauth-start to connect.' });
    return json(200, { connected: false, error: ch.error, detail: ch.detail });
  }
  return json(200, { connected: true, channel: ch.channel, ready_to_upload: true });
};
