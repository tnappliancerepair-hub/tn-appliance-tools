// frontdoor-test — owner-gated diagnostic. Tries to mint a Frontdoor JWT from the
// vaulted API key (FusionAuth password grant) and reports success WITHOUT leaking the
// token or credentials. Lets us verify the key is alive (and configured) before wiring.
//
//   GET /.netlify/functions/frontdoor-test?secret=<admin>&env=sandbox|production
'use strict';
const { getSecret } = require('./_lib/secrets');
const fd = require('./_lib/frontdoor');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const adminSecret = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== adminSecret) return json(401, { ok: false, error: 'admin secret required (?secret=)' });

  // ?push=1 — prove the Dispatch Status Update plumbing against SANDBOX (auth → POST →
  // structured response). ?dispatch=<id> &code=<STATUS key, e.g. EN_ROUTE>. A "dispatch not
  // found" is still a PASS — it means auth + endpoint + schema were accepted.
  if (q.push === '1') {
    const st = fd.STATUS[String(q.code || 'EN_ROUTE').toUpperCase()] || fd.STATUS.EN_ROUTE;
    try {
      const r = await fd.dispatchStatusUpdate({
        dispatchId: q.dispatch || 999999, statusCode: st.code, description: st.description,
        note: 'Ant connectivity test — ignore', vendorId: q.vendor || undefined,
      });
      return json(200, { ok: r.ok, mode: 'push', api_base: await fd.apiBase(), sent_status: st, http_status: r.status, data: r.data, raw: (r.raw || '').slice(0, 400) });
    } catch (e) { return json(200, { ok: false, mode: 'push', error: String((e && e.message) || e) }); }
  }

  const env = (q.env || (await getSecret('FRONTDOOR_ENV')) || 'sandbox').toLowerCase();
  const tokenUrl = env === 'production'
    ? 'https://login.frontdoorhome.com/oauth2/token'
    : 'https://frontdoorhome-dev.fusionauth.io/oauth2/token';

  const clientId = String(await getSecret('FRONTDOOR_CLIENT_ID') || '').trim();
  const username = String(await getSecret('FRONTDOOR_API_USERNAME') || '').trim();
  const password = String(await getSecret('FRONTDOOR_API_PASSWORD') || '').trim();
  const present = { client_id: !!clientId, username: !!username, password: !!password };
  if (!clientId || !username || !password) return json(200, { ok: false, env, present, error: 'one or more FRONTDOOR_* secrets missing from vault' });

  const form = new URLSearchParams();
  form.set('grant_type', 'password');
  form.set('client_id', clientId);
  form.set('username', username);
  form.set('password', password);

  let status = 0, ok = false, tokenAcquired = false, snippet = '';
  try {
    const r = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(), signal: AbortSignal.timeout(12000),
    });
    status = r.status;
    const text = await r.text();
    let j = {}; try { j = JSON.parse(text); } catch (_) {}
    tokenAcquired = !!(j.access_token || j.accessToken || j.token);
    ok = r.ok && tokenAcquired;
    // Only echo a short, non-sensitive snippet (error messages), never the token.
    snippet = tokenAcquired ? '(token received — hidden)' : text.slice(0, 200);
  } catch (e) {
    snippet = String((e && e.message) || e);
  }

  return json(200, {
    ok, env, token_url: tokenUrl, present,
    auth_status: status, token_acquired: tokenAcquired,
    detail: snippet,
    note: ok ? 'Auth works — key is live.' : 'No token yet — likely the API key still needs the config ticket processed on Frontdoor’s side (or wrong env). Expected until configured.',
  });
};
