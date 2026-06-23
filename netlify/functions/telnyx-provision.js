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
const SITE = 'https://tnapplianceexchange.net';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const CONNECTION_ID_DEFAULT = '2988827155447678681'; // "Ant office phone" credential connection
const OFFICE_DID = '+16155889591';                    // the office-phone number Ant transfers to

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
    // Set up "ring both cells": create a TeXML app pointing at office-texml and
    // re-point the office DID to it, so dialing the DID rings Teddy + Danielle.
    if (action === 'ringgroup') {
      const voiceUrl = `${SITE}/.netlify/functions/office-texml`;
      // 1) find or create the TeXML application
      let appId = null;
      const la = await fetch(`${TELNYX}/texml_applications?page[size]=100`, { headers: H, signal: AbortSignal.timeout(12000) });
      const ld = await la.json().catch(() => ({}));
      const existing = (ld.data || []).find((a) => (a.friendly_name === 'Ant Office Ring Group') || (a.voice_url === voiceUrl));
      if (existing) appId = existing.id;
      if (!appId) {
        const ca = await fetch(`${TELNYX}/texml_applications`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ friendly_name: 'Ant Office Ring Group', voice_url: voiceUrl, voice_method: 'POST', active: true }),
          signal: AbortSignal.timeout(12000),
        });
        const cd = await ca.json().catch(() => ({}));
        if (!ca.ok) return json(200, { ok: false, step: 'create_texml_app', status: ca.status, error: JSON.stringify(cd.errors || cd).slice(0, 300) });
        appId = cd.data && cd.data.id;
      }
      if (!appId) return json(200, { ok: false, error: 'no TeXML app id' });

      // 2) find the office DID's phone-number id
      const pn = await fetch(`${TELNYX}/phone_numbers?filter[phone_number]=${encodeURIComponent(OFFICE_DID)}`, { headers: H, signal: AbortSignal.timeout(12000) });
      const pd = await pn.json().catch(() => ({}));
      const numId = pd.data && pd.data[0] && pd.data[0].id;
      if (!numId) return json(200, { ok: false, step: 'find_did', error: `${OFFICE_DID} not found on account` });

      // 3) re-point the DID at the TeXML app
      const up = await fetch(`${TELNYX}/phone_numbers/${numId}`, {
        method: 'PATCH', headers: H, body: JSON.stringify({ connection_id: appId }), signal: AbortSignal.timeout(12000),
      });
      const ud = await up.json().catch(() => ({}));
      if (!up.ok) return json(200, { ok: false, step: 'repoint_did', status: up.status, error: JSON.stringify(ud.errors || ud).slice(0, 300) });

      return json(200, { ok: true, texml_app_id: appId, voice_url: voiceUrl, did: OFFICE_DID, did_now_points_to: 'Ant Office Ring Group', note: 'Dialing the office DID now rings both cells.' });
    }

    if (action === 'connections') {
      // Find the office-phone credential connection's real id + name.
      const r = await fetch(`${TELNYX}/credential_connections?page[size]=100`, { headers: H, signal: AbortSignal.timeout(12000) });
      const d = await r.json().catch(() => ({}));
      const conns = (d.data || []).map((c) => ({ id: c.id, name: c.connection_name || c.name }));
      return json(200, { ok: r.ok, connections: conns });
    }

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
