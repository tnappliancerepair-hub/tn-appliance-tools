// office-texml — TeXML that rings BOTH office cells at once when a caller is
// transferred to a human. Telnyx hits this when the office-phone DID is dialed
// (Ant's transfer target); both numbers ring simultaneously and the first to
// answer gets bridged to the caller. If nobody answers in `timeout`, the Dial
// fails and Ant falls back to taking a message.
//
// Numbers are vault-overridable (OFFICE_CELL_TEDDY / OFFICE_CELL_DANIELLE), so
// the office can change who's in the ring group without a code edit.
'use strict';

const { getSecret } = require('./_lib/secrets');

function esc(s) { return String(s || '').replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c])); }

exports.handler = async function () {
  const teddy = (await getSecret('OFFICE_CELL_TEDDY')) || '+16154855795';
  const danielle = (await getSecret('OFFICE_CELL_DANIELLE')) || '+16154850713';
  const callerId = (await getSecret('TELNYX_OFFICE_CALLER_NUMBER')) || '+16155889591';

  const nums = [teddy, danielle].filter(Boolean).map((n) => `    <Number>${esc(n)}</Number>`).join('\n');
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Response>\n' +
    `  <Dial callerId="${esc(callerId)}" timeout="25" answerOnBridge="true">\n` +
    nums + '\n' +
    '  </Dial>\n' +
    '</Response>';

  return { statusCode: 200, headers: { 'content-type': 'text/xml; charset=utf-8' }, body: xml };
};
