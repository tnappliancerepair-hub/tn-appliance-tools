// delete-parts-order — admin tool to remove a parts_orders row (test rows, or a
// mistaken/duplicate order). Dry-run shows the row; &confirm=1 deletes.
//   GET ?secret=<admin>&order_id=<id>[&confirm=1]
'use strict';
const { getSecret } = require('./_lib/secrets');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const PARTS_ORDERS = 47;
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const id = parseInt(q.order_id, 10);
  if (!id) return json(400, { ok: false, error: 'order_id required' });
  const token = process.env.XANO_METADATA_TOKEN;
  if (!token) return json(500, { ok: false, error: 'no metadata token' });
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  let row = null;
  try { row = await fetch(`${META}/table/${PARTS_ORDERS}/content/${id}`, { headers }).then((x) => x.json()); } catch (_) {}
  if (q.confirm !== '1') return json(200, { ok: true, mode: 'dryrun', order_id: id, row, note: 'add &confirm=1 to delete' });

  let r;
  try { r = await fetch(`${META}/table/${PARTS_ORDERS}/content/${id}`, { method: 'DELETE', headers }); }
  catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
  return json(200, { ok: r.ok, mode: 'deleted', order_id: id, http_status: r.status });
};
