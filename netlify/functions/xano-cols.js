// xano-cols — one-shot owner-gated probe: what columns does a raw Xano table actually
// carry? Used while moving TN off Xano to confirm which facts the mirror can source in
// bulk (the kanban feed drops several) before wiring them in. Read-only, no writes.
'use strict';
const { getSecret } = require('./_lib/secrets');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const json = (c, b) => ({ statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) });
exports.config = { timeout: 26 };
exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });
  const token = (await getSecret('XANO_METADATA_TOKEN')) || process.env.XANO_METADATA_TOKEN;
  if (!token) return json(200, { ok: false, error: 'no metadata token' });
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  try {
    if (q.tables) {
      const r = await fetch(`${META}/table`, { headers: H, signal: AbortSignal.timeout(20000) });
      const d = await r.json();
      const list = (d.items || d || []).map((t) => ({ id: t.id, name: t.name }));
      return json(200, { ok: true, tables: list });
    }
    const id = Number(q.table || 7);
    const body = q.field && q.value
      ? { search: { [q.field]: q.value }, sort: { id: 'desc' }, per_page: 1, page: 1 }
      : { sort: { id: 'desc' }, per_page: 1, page: 1 };
    const r = await fetch(`${META}/table/${id}/content/search`, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const d = await r.json();
    const it = (d.items || [])[0] || {};
    const keys = Object.keys(it).sort();
    const pat = q.match ? new RegExp(q.match, 'i') : /model|serial|brand|applian/i;
    return json(200, { ok: true, table: id, columns: keys.length, keys,
      matched: Object.fromEntries(keys.filter((k) => pat.test(k)).map((k) => [k, it[k]])) });
  } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
};
