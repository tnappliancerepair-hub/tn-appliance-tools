// r2-probe — owner-gated end-to-end check of the R2 credentials: writes a tiny test
// object, signs a GET, reads it back, deletes it. Confirms the vaulted R2_* creds work.
//   GET ?secret=<admin>
'use strict';
const { getSecret } = require('./_lib/secrets');
const r2 = require('./_lib/r2');
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== guard) return j(403, { ok: false, error: 'forbidden' });

  const present = {
    R2_ENDPOINT: !!(await getSecret('R2_ENDPOINT')),
    R2_BUCKET: !!(await getSecret('R2_BUCKET')),
    R2_ACCESS_KEY_ID: !!(await getSecret('R2_ACCESS_KEY_ID')),
    R2_SECRET_ACCESS_KEY: !!(await getSecret('R2_SECRET_ACCESS_KEY')),
  };
  if (!(await r2.isConfigured())) return j(200, { ok: false, present, error: 'missing R2 config — check the 4 vault values' });

  const key = `_probe/${Date.now()}.txt`;
  const body = 'ant r2 ok ' + new Date().toISOString();
  try {
    await r2.put(key, Buffer.from(body), 'text/plain');
    const url = await r2.presignGet(key, 120);
    const rr = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const got = await rr.text().catch(() => '');
    const readOk = rr.ok && got === body;
    await r2.del(key);
    return j(200, { ok: readOk, present, wrote: true, read_status: rr.status, read_matches: got === body, note: readOk ? 'R2 is live — write, signed-read, delete all work' : 'wrote but read-back failed' });
  } catch (e) {
    return j(200, { ok: false, present, error: String((e && e.message) || e).slice(0, 200) });
  }
};
