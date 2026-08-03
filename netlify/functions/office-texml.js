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
  const teddyNum = (await getSecret('OFFICE_CELL_TEDDY')) || '+16154855795';
  const danielleNum = (await getSecret('OFFICE_CELL_DANIELLE')) || '+16154850713';
  const sofiaNum = (await getSecret('OFFICE_CELL_SOFIA')) || '+16292594602';
  const callerId = (await getSecret('TELNYX_OFFICE_CALLER_NUMBER')) || '+16155889591';
  const teddyOn = !isOff(await getSecretFresh('OFFICE_REACH_TEDDY'));
  const danielleOn = !isOff(await getSecretFresh('OFFICE_REACH_DANIELLE'));
  const sofiaOn = !isOff(await getSecretFresh('OFFICE_REACH_SOFIA'));

  // Computer-app (WebRTC) inbound: ON by default; set OFFICE_PHONE_WEBRTC_INBOUND=off
  // to revert to cell-only. Each person's app leg only exists if their SIP login is
  // vaulted (created via telnyx-provision create who=…).
  const webrtcOn = !isOff(await getSecretFresh('OFFICE_PHONE_WEBRTC_INBOUND'));
  const teddySip = webrtcOn ? sipUri(await getSecret('TELNYX_SIP_USERNAME')) : '';
  const danielleSip = webrtcOn ? sipUri(await getSecret('TELNYX_SIP_USERNAME_DANIELLE')) : '';
  const sofiaSip = webrtcOn ? sipUri(await getSecret('TELNYX_SIP_USERNAME_SOFIA')) : '';

  const leg = ((event && event.queryStringParameters) || {}).leg || '1';

  // Leg 2 — the dispatcher ring finished. If someone answered, done; else Teddy
  // (cell if he's on + his computer app if registered).
  if (leg === '2') {
    const status = dialStatus(event);
    const answered = status === 'completed' || status === 'answered' || status === 'bridged';
    if (answered) return xmlResp('  <Hangup/>');
    const legs2 = [];
    if (teddyOn) legs2.push({ number: teddyNum });
    if (teddySip) legs2.push({ sip: teddySip });
    if (!legs2.length) return xmlResp('  <Hangup/>');
    return xmlResp(dialLegs(legs2, callerId, 25, null));
  }

  // Leg 1 — dispatchers: cell (reach-gated) + computer app (rings if they're On in
  // the app). Sofia's cell is off but her computer still rings.
  const legs = [];
  if (danielleOn) legs.push({ number: danielleNum });
  if (danielleSip) legs.push({ sip: danielleSip });
  if (sofiaOn) legs.push({ number: sofiaNum });
  if (sofiaSip) legs.push({ sip: sofiaSip });
  if (legs.length) return xmlResp(dialLegs(legs, callerId, 20, `${SELF}?leg=2`));

  // No dispatcher reachable — go straight to Teddy (cell + his app), else nobody.
  const legsT = [];
  if (teddyOn) legsT.push({ number: teddyNum });
  if (teddySip) legsT.push({ sip: teddySip });
  if (legsT.length) return xmlResp(dialLegs(legsT, callerId, 25, null));
  return xmlResp('  <Reject/>');
};
