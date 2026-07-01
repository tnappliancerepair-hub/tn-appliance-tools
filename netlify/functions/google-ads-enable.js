// google-ads-enable — turn a campaign ON or OFF, or REMOVE it (delete).
//   GET ?secret=&campaign=<id>&status=ENABLED|PAUSED|REMOVED[&cid=]
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const id = String(q.campaign || '').replace(/\D/g, '');
  const st = String(q.status || 'ENABLED').toUpperCase();
  const status = (st === 'PAUSED' || st === 'REMOVED') ? st : 'ENABLED';
  if (!id) return json(400, { ok: false, error: 'pass &campaign=<id>' });

  const c = await ads.creds();
  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const url = `https://googleads.googleapis.com/${c.version}/customers/${cid}/campaigns:mutate`;
  const body = JSON.stringify({ operations: [{ update: { resourceName: `customers/${cid}/campaigns/${id}`, status }, updateMask: 'status' }] });
  let r, d;
  try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body }); d = await r.json().catch(() => ({})); }
  catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }
  if (!r.ok && r.status === 403 && c.managerId) {
    try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body }); d = await r.json().catch(() => ({})); } catch (_) {}
  }
  return json(200, { ok: r.ok, campaign: id, status, result: r.ok ? (d.results && d.results[0]) : null, error: r.ok ? null : ((d.error && d.error.message) || d) });
};
