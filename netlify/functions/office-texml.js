// office-texml — TeXML that rings the office cells when a caller is transferred
// to a human. Each person has their OWN availability flag (OFFICE_REACH_TEDDY /
// OFFICE_REACH_DANIELLE) so they can go on/off independently (different vacations).
// Only the people who are ON get dialed; first to answer bridges. Flags are read
// FRESH (no cache) so a toggle takes effect on the very next call.
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');

function esc(s) { return String(s || '').replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c])); }
function isOff(v) { return String(v || '').trim().toLowerCase() === 'off'; }

exports.handler = async function () {
  const teddyNum = (await getSecret('OFFICE_CELL_TEDDY')) || '+16154855795';
  const danielleNum = (await getSecret('OFFICE_CELL_DANIELLE')) || '+16154850713';
  const callerId = (await getSecret('TELNYX_OFFICE_CALLER_NUMBER')) || '+16155889591';

  // Default ON when unset; only "off" removes a person from the ring.
  const teddyOn = !isOff(await getSecretFresh('OFFICE_REACH_TEDDY'));
  const danielleOn = !isOff(await getSecretFresh('OFFICE_REACH_DANIELLE'));

  const nums = [];
  if (teddyOn) nums.push(teddyNum);
  if (danielleOn) nums.push(danielleNum);

  let inner;
  if (!nums.length) {
    // Nobody available — reject so the caller isn't left hanging (Ant will have
    // taken a message path; this is a belt-and-suspenders).
    inner = '  <Reject/>';
  } else {
    inner = `  <Dial callerId="${esc(callerId)}" timeout="25" answerOnBridge="true">\n` +
      nums.map((n) => `    <Number>${esc(n)}</Number>`).join('\n') + '\n  </Dial>';
  }

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n' + inner + '\n</Response>';
  return { statusCode: 200, headers: { 'content-type': 'text/xml; charset=utf-8' }, body: xml };
};
