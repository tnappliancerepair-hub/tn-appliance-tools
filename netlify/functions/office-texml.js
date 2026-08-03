// office-texml — TeXML that rings the office when a caller is transferred to a human.
// PRIORITY ORDER (Teddy 2026-08-03): ring DANIELLE first; only if she doesn't answer
// does it fall back to TEDDY. Sequential, not simultaneous — Danielle is the primary
// office answerer, Teddy is the backup. Each person has their own availability flag
// (OFFICE_REACH_DANIELLE / OFFICE_REACH_TEDDY) read FRESH so a toggle applies on the
// next call; anyone Off is skipped. Nobody On -> Reject (Ann took a message).
//
// How the sequence works: leg 1 dials Danielle with an `action` webhook back here
// (?leg=2). When that Dial ends Telnyx POSTs DialCallStatus — if she answered
// (completed) we hang up; otherwise leg 2 rings Teddy.
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');

const SELF = 'https://tnapplianceexchange.net/.netlify/functions/office-texml';
function esc(s) { return String(s || '').replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c])); }
function isOff(v) { return String(v || '').trim().toLowerCase() === 'off'; }
function xmlResp(inner) {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n' + inner + '\n</Response>';
  return { statusCode: 200, headers: { 'content-type': 'text/xml; charset=utf-8' }, body: xml };
}
function dial(num, callerId, timeout, actionUrl) {
  const action = actionUrl ? ` action="${esc(actionUrl)}" method="POST"` : '';
  return `  <Dial callerId="${esc(callerId)}" timeout="${timeout}" answerOnBridge="true"${action}>\n`
    + `    <Number>${esc(num)}</Number>\n  </Dial>`;
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
  const callerId = (await getSecret('TELNYX_OFFICE_CALLER_NUMBER')) || '+16155889591';
  const teddyOn = !isOff(await getSecretFresh('OFFICE_REACH_TEDDY'));
  const danielleOn = !isOff(await getSecretFresh('OFFICE_REACH_DANIELLE'));
  const leg = ((event && event.queryStringParameters) || {}).leg || '1';

  // Leg 2 — Danielle's dial finished. If she answered, we're done; else fall back to Teddy.
  if (leg === '2') {
    const status = dialStatus(event);
    const answered = status === 'completed' || status === 'answered' || status === 'bridged';
    if (answered || !teddyOn) return xmlResp('  <Hangup/>');
    return xmlResp(dial(teddyNum, callerId, 25, null));
  }

  // Leg 1 — ring Danielle first (with the fallback webhook), unless she's off.
  if (danielleOn) return xmlResp(dial(danielleNum, callerId, 20, `${SELF}?leg=2`));
  // Danielle off — go straight to Teddy if he's on, else nobody's available.
  if (teddyOn) return xmlResp(dial(teddyNum, callerId, 25, null));
  return xmlResp('  <Reject/>');
};
