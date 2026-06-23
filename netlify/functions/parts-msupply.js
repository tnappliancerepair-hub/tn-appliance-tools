// parts-msupply — test + use endpoint for the mSupply parts connector.
//   ...&action=token                 -> verify auth (gets a bearer token)
//   ...&action=lookup&part=WPW10..&make=Whirlpool   -> price + stock for a part
// Gated by the same admin secret as vapi-admin (vault VAPI_ADMIN_SECRET, with the
// legacy fallback) so it's easy to hit from a browser while wiring, without
// exposing it publicly.
'use strict';

const { getSecret } = require('./_lib/secrets');
const msupply = require('./_lib/msupply');
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return { statusCode: 403, body: 'forbidden' };

  // &env=prod points lookups at the real catalog (read-only/safe). getSecret is
  // env-first, so this overrides MSUPPLY_BASE_URL for this invocation.
  if (q.env === 'prod') process.env.MSUPPLY_BASE_URL = 'https://api.msupply.com';

  const action = q.action || 'token';
  try {
    if (q.env === 'prod') { try { await msupply.getToken(true); } catch (_) {} }
    if (action === 'token') {
      const t = await msupply.getToken(true);
      const base = await msupply.baseUrl();
      return json(200, { ok: true, base, token_preview: String(t).slice(0, 12) + '…', note: 'auth works' });
    }
    if (action === 'lookup') {
      if (!q.part) return json(400, { ok: false, error: 'pass &part=<partNumber> (and &make=)' });
      const r = await msupply.lookupPart(q.part, q.make, { zip: q.zip });
      return json(200, r);
    }
    return json(400, { ok: false, error: 'unknown action; use token|lookup' });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
