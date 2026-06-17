// register-parts-daemon — the Mac tunnel script POSTs its current public URL here
// so the cloud always knows where to reach the live parts daemon, even when the
// (free) quick-tunnel URL changes on restart. Stores PARTS_DAEMON_URL in the vault.
//
//   POST { secret, url }  ->  { ok }
'use strict';

const XANO_META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const { configTableId } = require('./_lib/secrets');

const SECRET = 'tn-parts-daemon-2026';
const KEY = 'PARTS_DAEMON_URL';

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function j(code, body) { return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return j(400, { ok: false, error: 'invalid_json' }); }
  if (b.secret !== SECRET) return j(401, { ok: false, error: 'unauthorized' });
  const url = String(b.url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) return j(400, { ok: false, error: 'valid url required' });

  try {
    const tid = await configTableId();
    const sr = await fetch(`${XANO_META}/table/${tid}/content/search`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ search: { name: KEY }, per_page: 5, page: 1 }),
    });
    const sd = sr.ok ? await sr.json() : { items: [] };
    const existing = ((sd && sd.items) || []).find((x) => x && x.name === KEY);
    if (existing) {
      const ur = await fetch(`${XANO_META}/table/${tid}/content/${existing.id}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ name: KEY, value: url }) });
      if (!ur.ok) return j(502, { ok: false, error: 'update_failed ' + ur.status });
    } else {
      const ir = await fetch(`${XANO_META}/table/${tid}/content`, { method: 'POST', headers: headers(), body: JSON.stringify({ name: KEY, value: url }) });
      if (!ir.ok) return j(502, { ok: false, error: 'insert_failed ' + ir.status });
    }
    return j(200, { ok: true, registered: url });
  } catch (err) {
    return j(200, { ok: false, error: err.message });
  }
};
