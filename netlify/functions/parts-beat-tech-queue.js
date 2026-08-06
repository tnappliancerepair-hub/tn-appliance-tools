// parts-beat-tech-queue — non-scheduled reader for the office "Beat the Tech" page.
// Netlify 403s manual HTTP to the scheduled parts-beat-tech, so the page reads here
// (shares the exact same identify logic via buildQueue).
//   GET ?secret=<admin>  |  ?office=<office password>
'use strict';
const { getSecret } = require('./_lib/secrets');
const { buildQueue, verifyOffice } = require('./parts-beat-tech');

exports.config = { timeout: 26 };
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin && !(q.office && await verifyOffice(q.office))) return json(401, { ok: false, error: 'unauthorized — ?secret= or ?office=' });
  if (String(await getSecret('PARTS_BEAT_TECH') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  try { return json(200, await buildQueue()); } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
};
