// office-texml — TeXML that rings the office when a caller is transferred to a human.
//
// PRIORITY (Teddy 2026-08-03): ring the DISPATCHERS (Danielle + Sofia) first, then
// fall back to TEDDY. Two ways to be reached, independent:
//   • CELL   — gated by OFFICE_REACH_<NAME> ("off" = don't ring my cell).
//   • COMPUTER APP (office-phone.html WebRTC) — rings whenever that person is On in
//     the app (registered on the "Ant office phone" credential connection). Reached
//     by dialing sip:<sip_username>@sip.telnyx.com. Not gated by the reach flag, so
//     e.g. Sofia can take calls on her computer with her CELL turned off. If the app
//     isn't On, that SIP leg just doesn't answer — harmless.
// One <Dial> mixes <Number> (cells) + <Sip> (apps); they ring in parallel, first to
// answer wins. Leg 1 rings the dispatchers with an action webhook (?leg=2); if none
// answer, leg 2 rings Teddy.
//
// SAFETY: the computer-app (SIP) legs are behind OFFICE_PHONE_WEBRTC_INBOUND — set it
// to "off" to instantly revert to the known-good cell-only ring.
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const SELF = 'https://tnapplianceexchange.net/.netlify/functions/office-texml';
function esc(s) { return String(s || '').replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c])); }
function isOff(v) { return String(v || '').trim().toLowerCase() === 'off'; }
function sipUri(username) { const u = String(username || '').trim(); return u ? `sip:${u}@sip.telnyx.com` : ''; }
function xmlResp(inner) {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n' + inner + '\n</Response>';
  return { statusCode: 200, headers: { 'content-type': 'text/xml; charset=utf-8' }, body: xml };
}
// legs: array of { number } (cell) or { sip } (computer app). Rings all in parallel.
function dialLegs(legs, callerId, timeout, actionUrl) {
  const action = actionUrl ? ` action="${esc(actionUrl)}" method="POST"` : '';
  const inner = legs
    .map((l) => (l.sip ? `    <Sip>${esc(l.sip)}</Sip>` : `    <Number>${esc(l.number)}</Number>`))
    .join('\n');
  return `  <Dial callerId="${esc(callerId)}" timeout="${timeout}" answerOnBridge="true"${action}>\n${inner}\n  </Dial>`;
}
// Telnyx posts the action webhook form-encoded; pull one field out of the body.
function formField(event, name) {
  try {
    const body = event && event.body ? event.body : '';
    const re = new RegExp('(?:^|&)' + name + '=([^&]*)', 'i');
    const m = re.exec(body);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  } catch (_) { return ''; }
}
function dialStatus(event) { return String(formField(event, 'DialCallStatus')).toLowerCase(); }

// PHONE-TRANSFER-OUTCOME LOGGING (Teddy 2026-08-06). Pure measurement, additive —
// records who answered vs missed each transferred call so we can answer "are the
// humans answering the phones?" and attribute call-catching to Sofia/Danielle/Teddy.
// Wrapped in a short race so a slow Xano can NEVER delay the caller's next ring
// (crud.logEvent already has its own retry/timeout; this is the hard on-call cap).
function raceLog(action, metadata, capMs) {
  const cap = capMs || 1200;
  return Promise.race([
    crud.logEvent(action, metadata),
    new Promise((r) => setTimeout(r, cap)),
  ]).catch(() => null);
}
async function logTransferOutcome({ tier, answered, status, event, leg }) {
  if (!tier) return;
  await raceLog('phone_transfer_outcome', {
    outcome: answered ? 'answered' : 'missed',
    answered_by: answered ? tier.name : '',
    missed_by: answered ? '' : tier.name,
    tier: tier.name,
    tier_index: (leg - 2),
    dial_status: status || '',
    caller: formField(event, 'From') || '',
    to: formField(event, 'To') || '',
    call_sid: formField(event, 'CallSid') || '',
    leg,
    at_ms: Date.now(),
  });
}

exports.handler = async function (event) {
  const callerId = (await getSecret('TELNYX_OFFICE_CALLER_NUMBER')) || '+16155889591';
  // Computer-app (WebRTC) inbound: ON by default; set OFFICE_PHONE_WEBRTC_INBOUND=off
  // to revert to cell-only. A person's app leg only exists if their SIP login is
  // vaulted (created via telnyx-provision create who=…).
  const webrtcOn = !isOff(await getSecretFresh('OFFICE_PHONE_WEBRTC_INBOUND'));

  // PRIORITY (Teddy 2026-08-04): Sofia FIRST, Danielle SECOND, Teddy last-resort.
  // Each tier rings that person's cell (gated by OFFICE_REACH_<NAME>="off") AND their
  // computer app (if their SIP login is vaulted). A tier with nobody reachable is
  // skipped to the next. A tier that doesn't answer in ~20s chains to the next via the
  // action webhook (?leg=N). Teddy's SIP falls back to the legacy TELNYX_SIP_USERNAME.
  const SOFIA =    { name: 'Sofia',    cell: (await getSecret('OFFICE_CELL_SOFIA')) || '+16292594602',    on: !isOff(await getSecretFresh('OFFICE_REACH_SOFIA')),    sip: webrtcOn ? sipUri(await getSecret('TELNYX_SIP_USERNAME_SOFIA')) : '' };
  const DANIELLE = { name: 'Danielle', cell: (await getSecret('OFFICE_CELL_DANIELLE')) || '+16154850713', on: !isOff(await getSecretFresh('OFFICE_REACH_DANIELLE')), sip: webrtcOn ? sipUri(await getSecret('TELNYX_SIP_USERNAME_DANIELLE')) : '' };
  const TEDDY =    { name: 'Teddy',    cell: (await getSecret('OFFICE_CELL_TEDDY')) || '+16154855795',     on: !isOff(await getSecretFresh('OFFICE_REACH_TEDDY')),     sip: webrtcOn ? sipUri((await getSecret('TELNYX_SIP_USERNAME_TEDDY')) || (await getSecret('TELNYX_SIP_USERNAME'))) : '' };
  // ORDER (Teddy 2026-08-13): warranty-company reps go to DANIELLE first, then Sofia, then
  // Teddy — she handles warranty check-ups fastest. Everyone else keeps the Sofia-first
  // order. Set by the "Warranty Desk" TeXML app whose voice_url carries ?order=warranty.
  const order = String(((event && event.queryStringParameters) || {}).order || '').toLowerCase();
  const warrantyFirst = order === 'warranty' || order === 'danielle';
  const tiers = warrantyFirst ? [DANIELLE, SOFIA, TEDDY] : [SOFIA, DANIELLE, TEDDY];
  const orderQS = warrantyFirst ? `order=${order}&` : '';
  const legsFor = (t) => { const a = []; if (t.on && t.cell) a.push({ number: t.cell }); if (t.sip) a.push({ sip: t.sip }); return a; };

  // Per-tier ring length (seconds). Danielle reported her cell "rang once then went
  // away" — a 20s timeout is too short once the carrier's call-setup delay (often 5–10s
  // before the phone audibly rings) is subtracted, so a tier could move on after ~1 ring.
  // Give each cell a full ~30s ring (≈5 rings) to actually grab it. Vault-tunable via
  // OFFICE_RING_SECONDS (clamped 15–45) so the cadence can change without a redeploy.
  let ringSecs = parseInt(await getSecret('OFFICE_RING_SECONDS'), 10);
  if (!(ringSecs >= 15 && ringSecs <= 45)) ringSecs = 30;

  let leg = parseInt(((event && event.queryStringParameters) || {}).leg, 10);
  if (!(leg >= 1)) leg = 1;

  // A prior tier's ring already reported back. The action was set to ?leg=<i+2> for the
  // tier at index i, so the tier just rung = tiers[leg-2]. Log whether it answered or was
  // missed (measurement only — never changes the ring behavior below).
  if (leg > 1) {
    const st = dialStatus(event);
    const answered = st === 'completed' || st === 'answered' || st === 'bridged';
    const rung = tiers[leg - 2];
    await logTransferOutcome({ tier: rung, answered, status: st, event, leg });
    if (answered) return xmlResp('  <Hangup/>');
  }

  // Ring the first reachable tier at or after `leg`; chain to the next if it doesn't answer.
  for (let i = leg - 1; i < tiers.length; i++) {
    const legs = legsFor(tiers[i]);
    if (!legs.length) continue;
    const moreAhead = tiers.slice(i + 1).some((t) => legsFor(t).length);
    const action = moreAhead ? `${SELF}?${orderQS}leg=${i + 2}` : null;
    // Final reachable tier gets a slightly longer ring (last chance before it falls through).
    return xmlResp(dialLegs(legs, callerId, moreAhead ? ringSecs : Math.min(ringSecs + 5, 45), action));
  }
  return xmlResp('  <Reject/>');
};
