// xano-env-probe — owner-gated, read-only: can our Xano metadata token reach
// workspace ENVIRONMENT VARIABLES (where OFFICE_PASSWORD lives)? Tries the likely
// metadata endpoints and reports status + whether env is exposed. No writes.
//   GET ?secret=<admin>
'use strict';
const { getSecret } = require('./_lib/secrets');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const tok = await getSecret('XANO_METADATA_TOKEN');
  if (!tok) return json(200, { ok: false, error: 'no metadata token in vault/env' });
  const H = { Authorization: `Bearer ${tok}`, Accept: 'application/json' };

  const paths = [
    { m: 'GET', u: `${META}` },
    { m: 'GET', u: `${META}/env` },
    { m: 'GET', u: `${META}/environment` },
    { m: 'GET', u: `${META}/env_variable` },
    { m: 'GET', u: `https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/env` },
    { m: 'GET', u: `https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/environment_variable` },
  ];
  const out = [];
  for (const p of paths) {
    try {
      const r = await fetch(p.u, { method: p.m, headers: H, signal: AbortSignal.timeout(9000) });
      const txt = (await r.text()).slice(0, 400);
      const hasEnv = /OFFICE_PASSWORD|env|variable/i.test(txt);
      out.push({ path: p.u.replace('https://xbtp-g9bh-ditq.n7e.xano.io', ''), status: r.status, mentions_env: hasEnv, sample: txt.slice(0, 160) });
    } catch (e) { out.push({ path: p.u, error: String((e && e.message) || e) }); }
  }
  return json(200, { ok: true, note: 'read-only probe of Xano metadata for env-var access', results: out });
};
