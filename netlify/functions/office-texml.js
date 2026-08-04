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
// Telnyx posts the action webhook form-encoded; pull DialCallStatus out of the body.
function dialStatus(event) {
  try {
    const body = event && event.body ? event.body : '';
    const m = /(?:^|&)DialCallStatus=([^&]*)/i.exec(body);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')).toLowerCase() : '';
  } catch (_) { return ''; }
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
  const tiers = [
    { name: 'Sofia',    cell: (await getSecret('OFFICE_CELL_SOFIA')) || '+16292594602',    on: !isOff(await getSecretFresh('OFFICE_REACH_SOFIA')),    sip: webrtcOn ? sipUri(await getSecret('TELNYX_SIP_USERNAME_SOFIA')) : '' },
    { name: 'Danielle', cell: (await getSecret('OFFICE_CELL_DANIELLE')) || '+16154850713', on: !isOff(await getSecretFresh('OFFICE_REACH_DANIELLE')), sip: webrtcOn ? sipUri(await getSecret('TELNYX_SIP_USERNAME_DANIELLE')) : '' },
    { name: 'Teddy',    cell: (await getSecret('OFFICE_CELL_TEDDY')) || '+16154855795',     on: !isOff(await getSecretFresh('OFFICE_REACH_TEDDY')),     sip: webrtcOn ? sipUri((await getSecret('TELNYX_SIP_USERNAME_TEDDY')) || (await getSecret('TELNYX_SIP_USERNAME'))) : '' },
  ];
  const legsFor = (t) => { const a = []; if (t.on && t.cell) a.push({ number: t.cell }); if (t.sip) a.push({ sip: t.sip }); return a; };

  let leg = parseInt(((event && event.queryStringParameters) || {}).leg, 10);
  if (!(leg >= 1)) leg = 1;

  // A prior tier's ring already connected → done.
  if (leg > 1) {
    const st = dialStatus(event);
    if (st === 'completed' || st === 'answered' || st === 'bridged') return xmlResp('  <Hangup/>');
  }

  // Ring the first reachable tier at or after `leg`; chain to the next if it doesn't answer.
  for (let i = leg - 1; i < tiers.length; i++) {
    const legs = legsFor(tiers[i]);
    if (!legs.length) continue;
    const moreAhead = tiers.slice(i + 1).some((t) => legsFor(t).length);
    const action = moreAhead ? `${SELF}?leg=${i + 2}` : null;
    return xmlResp(dialLegs(legs, callerId, moreAhead ? 20 : 25, action));
  }
  return xmlResp('  <Reject/>');
};
