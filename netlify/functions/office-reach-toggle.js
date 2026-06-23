// office-reach-toggle — the on/off switch for "talk to a human" call forwarding.
// office-password gated. ON points Ant's transfer at the office cell(s); OFF
// removes the transfer so Ant just takes a message (vacation mode). It drives the
// existing vapi-admin `wireoffice` action server-side so the Vapi admin secret
// never touches the browser.
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const { getSecret } = require('./_lib/secrets');
const ADMIN_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }

async function verifyOffice(password) {
  if (!password) return false;
  try {
    const r = await fetch(`${XANO}/verify_office_password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }), signal: AbortSignal.timeout(8000),
    });
    const d = await r.json().catch(() => ({}));
    return !!(d && (d.valid || d.success || d.ok));
  } catch (_) { return false; }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, reason: 'method' });
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  if (!(await verifyOffice(body.password))) return json(401, { ok: false, reason: 'unauthorized' });

  const adminSec = (await getSecret('VAPI_ADMIN_SECRET')) || ADMIN_FALLBACK;
  // On rings the office ring-group DID (615-588-9591 -> both Teddy + Danielle's
  // cells via TeXML); Off takes a message. Override via vault OFFICE_TRANSFER_NUMBER.
  const cell = (await getSecret('OFFICE_TRANSFER_NUMBER')) || '+16155889591';
  const action = String(body.action || 'status');

  let url;
  if (action === 'on') url = `${SITE}/.netlify/functions/vapi-admin?secret=${encodeURIComponent(adminSec)}&action=wireoffice&number=${encodeURIComponent(cell)}`;
  else if (action === 'off') url = `${SITE}/.netlify/functions/vapi-admin?secret=${encodeURIComponent(adminSec)}&action=wireoffice&apply=off`;
  else url = `${SITE}/.netlify/functions/vapi-admin?secret=${encodeURIComponent(adminSec)}&action=voice`;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const d = await r.json().catch(() => ({}));
    // Derive on/off from whatever the admin call returned.
    let on = false, dest = null;
    if (action === 'status') {
      const t = d && d.transferCall;
      on = !!(t && t !== 'NONE' && t.destinations && t.destinations.length);
      dest = t && t.destinations ? t.destinations : null;
    } else {
      on = !d.disabled && !!(d.transfer_destinations && d.transfer_destinations.length);
      dest = d.transfer_destinations || null;
    }
    const num = dest && dest[0] && (dest[0].number || dest[0].sipUri) || cell;
    return json(200, { ok: true, on, rings: num });
  } catch (e) {
    return json(200, { ok: false, reason: 'admin_call_failed', detail: String((e && e.message) || e) });
  }
};
