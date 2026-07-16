// office-reach-toggle — per-person on/off for "talk to a human." Teddy and
// Danielle each have their own switch (different vacation times). Flipping a
// switch sets that person's availability flag; the office-texml ring group then
// dials only the people who are ON. If BOTH are off, Ant's transfer is removed
// entirely so it just takes a message (no dead transfer). Office-password gated.
//
//   POST { password, who:'teddy'|'danielle', action:'on'|'off' }  -> set + recompute
//   POST { password, action:'status' }                            -> read both
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const { getSecretFresh, setSecret } = require('./_lib/secrets');
const ADMIN_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const RING_GROUP_DID = '+16155889591';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }
function isOff(v) { return String(v || '').trim().toLowerCase() === 'off'; }

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

async function readState() {
  const teddyOn = !isOff(await getSecretFresh('OFFICE_REACH_TEDDY'));
  const danielleOn = !isOff(await getSecretFresh('OFFICE_REACH_DANIELLE'));
  return { teddyOn, danielleOn };
}

// Keep Ant's transfer in sync: any one available -> transfer ON (to ring group);
// both off -> transfer OFF (Ant takes a message).
async function syncTransfer(anyOn) {
  const adminSec = (await getSecretFresh('VAPI_ADMIN_SECRET')) || ADMIN_FALLBACK;
  const url = anyOn
    ? `${SITE}/.netlify/functions/vapi-admin?secret=${encodeURIComponent(adminSec)}&action=wireoffice&number=${encodeURIComponent(RING_GROUP_DID)}`
    : `${SITE}/.netlify/functions/vapi-admin?secret=${encodeURIComponent(adminSec)}&action=wireoffice&apply=off`;
  try { await fetch(url, { signal: AbortSignal.timeout(12000) }); } catch (_) {}
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, reason: 'method' });
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  if (!(await verifyOffice(body.password))) return json(401, { ok: false, reason: 'unauthorized' });

  const action = String(body.action || 'status');

  let saveFailed = false;
  if (action === 'on' || action === 'off') {
    const who = String(body.who || '').toLowerCase();
    if (who !== 'teddy' && who !== 'danielle') return json(400, { ok: false, reason: 'who must be teddy or danielle' });
    // setSecret now verifies + retries; if it STILL couldn't persist, say so instead
    // of silently returning a stale state (which read as the switch "flipping off").
    const ok = await setSecret('OFFICE_REACH_' + who.toUpperCase(), action === 'on' ? 'on' : 'off');
    saveFailed = !ok;
  }

  const { teddyOn, danielleOn } = await readState();
  await syncTransfer(teddyOn || danielleOn);
  return json(200, { ok: !saveFailed, saved: !saveFailed, teddyOn, danielleOn, transfer_on: teddyOn || danielleOn, reason: saveFailed ? 'save did not persist — tap again' : undefined });
};
