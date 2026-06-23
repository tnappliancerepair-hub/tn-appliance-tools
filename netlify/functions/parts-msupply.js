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

  // Env overrides for THIS invocation only (cleared in finally so a warm container
  // isn't poisoned):
  //   &env=prod    -> base + token both Production
  //   &env=prodapi -> Production API base, but token from the Integration auth URL
  //                   (theory: one shared auth server, token valid across envs)
  const hadBase = process.env.MSUPPLY_BASE_URL;
  const hadTok = process.env.MSUPPLY_TOKEN_URL;
  if (q.env === 'prod') process.env.MSUPPLY_BASE_URL = 'https://api.msupply.com';
  if (q.env === 'prodapi') {
    process.env.MSUPPLY_BASE_URL = 'https://api.msupply.com';
    process.env.MSUPPLY_TOKEN_URL = 'https://int-api.msupply.com/AccessToken';
  }
  const overrode = (q.env === 'prod' || q.env === 'prodapi');

  const action = q.action || 'token';
  try {
    if (overrode) { try { await msupply.getToken(true); } catch (_) {} }
    if (action === 'config') {
      const { getSecretFresh } = require('./_lib/secrets');
      const base = await msupply.baseUrl();
      const cid = (await getSecretFresh('MSUPPLY_CLIENT_ID')) || '';
      const csec = (await getSecretFresh('MSUPPLY_CLIENT_SECRET')) || '';
      const tok = (await getSecretFresh('MSUPPLY_TOKEN_URL')) || '';
      const scope = (await getSecretFresh('MSUPPLY_SCOPE')) || '';
      const cust = (await getSecretFresh('MSUPPLY_CUST_NO')) || '';
      return json(200, {
        ok: true, base,
        token_url_used: tok || (base + '/AccessToken'),
        client_id_preview: cid ? (cid.slice(0, 6) + '…' + cid.slice(-3) + ' (len ' + cid.length + ')') : 'MISSING',
        client_secret_len: csec.length, scope: scope || '(none)', cust_no: cust || '(none)',
      });
    }

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
  } finally {
    // restore so a warm container's later integration calls aren't poisoned
    if (overrode) {
      if (hadBase) process.env.MSUPPLY_BASE_URL = hadBase; else delete process.env.MSUPPLY_BASE_URL;
      if (hadTok) process.env.MSUPPLY_TOKEN_URL = hadTok; else delete process.env.MSUPPLY_TOKEN_URL;
      await msupply.getToken(true).catch(() => {});
    }
  }
};
