// telnyx-provision — create separate SIP logins for the Office Phone so Teddy and
// Danielle don't share one credential (sharing caused the WebSocket thrash that
// dropped calls). Creates a Telnyx "telephony credential" under the office-phone
// Credential Connection and stores its sip_username/password straight into the
// vault (per person), so the token endpoint can hand each device its own login.
//
// Both credentials live under the SAME connection, so the office DID forks the
// call to every registered device — i.e. it rings Teddy AND Danielle at once.
//
//   ...&action=create&who=danielle     -> makes Danielle's login, vaults it
//   ...&action=create&who=teddy        -> (re)makes Teddy's login, vaults it
//   ...&action=list                    -> list credentials on the connection
// Guarded by the vapi-admin secret. Needs TELNYX_API_KEY in the vault.
'use strict';

const { getSecret, setSecret } = require('./_lib/secrets');
const TELNYX = 'https://api.telnyx.com/v2';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const CONNECTION_ID_DEFAULT = '29882725547678841'; // "Ant office phone" credential connection

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return { statusCode: 403, body: 'forbidden' };

  const KEY = await getSecret('TELNYX_API_KEY');
  if (!KEY) return json(200, { ok: false, error: 'TELNYX_API_KEY not in vault — add it in admin-secrets.html' });
  const connId = (await getSecret('TELNYX_OFFICE_CONNECTION_ID')) || CONNECTION_ID_DEFAULT;
  const action = q.action || 'list';
  const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' };

  try {
    if (action === 'list') {
      const r = await fetch(`${TELNYX}/telephony_credentials?filter[connection_id]=${connId}&page[size]=50`, { headers: H, signal: AbortSignal.timeout(12000) });
      const d = await r.json().catch(() => ({}));
      const creds = (d.data || []).map((c) => ({ id: c.id, name: c.name, sip_username: c.sip_username, expired: c.expired }));
      return json(200, { ok: r.ok, connection_id: connId, credentials: creds });
    }

    if (action === 'create') {
      const who = String(q.who || '').toLowerCase();
      if (who !== 'teddy' && who !== 'danielle') return json(400, { ok: false, error: 'pass &who=teddy or &who=danielle' });
      const name = 'Ant Office Phone - ' + (who === 'danielle' ? 'Danielle' : 'Teddy');
      const r = await fetch(`${TELNYX}/telephony_credentials`, {
        method: 'POST', headers: H, body: JSON.stringify({ connection_id: connId, name }), signal: AbortSignal.timeout(12000),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return json(200, { ok: false, status: r.status, error: (d.errors && JSON.stringify(d.errors)) || JSON.stringify(d).slice(0, 300) });
      const c = d.data || {};
      if (!c.sip_username || !c.sip_password) return json(200, { ok: false, error: 'no sip_username/password returned', raw: c });
      const suffix = who === 'danielle' ? '_DANIELLE' : '';
      await setSecret('TELNYX_SIP_USERNAME' + suffix, c.sip_username);
      await setSecret('TELNYX_SIP_PASSWORD' + suffix, c.sip_password);
      return json(200, {
        ok: true, who, credential_id: c.id, sip_username: c.sip_username,
        vaulted: ['TELNYX_SIP_USERNAME' + suffix, 'TELNYX_SIP_PASSWORD' + suffix],
        note: who + "'s login is created and saved. Their app will use it on next On.",
      });
    }

    return json(400, { ok: false, error: 'unknown action; use create|list' });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
