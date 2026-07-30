// office-callout-texml — the TeXML Telnyx runs AFTER the office person's cell
// answers a click-to-call bridge (see office-callout.js). It dials the customer
// and bridges the two legs, so the office person talks to the customer with the
// shop's number as caller ID. `to` = customer E.164 (validated by office-callout
// before origination; re-validated here so a malformed URL can't dial garbage).
'use strict';
const { getSecret } = require('./_lib/secrets');

function xml(body) { return { statusCode: 200, headers: { 'content-type': 'text/xml; charset=utf-8' }, body: '<?xml version="1.0" encoding="UTF-8"?>\n' + body }; }
function esc(s) { return String(s || '').replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c])); }
function e164(v) {
  let d = String(v || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return /^\+\d{8,15}$/.test(d) ? d : '';
  d = d.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return '';
}

exports.handler = async function (event) {
  const q = (event.queryStringParameters || {});
  const to = e164(q.to);
  const callerId = (await getSecret('TELNYX_OFFICE_CUSTOMER_NUMBER')) || (await getSecret('TELNYX_OFFICE_CALLER_NUMBER')) || '+16155889500';
  if (!to) {
    // No valid customer number — say so instead of dialing nothing.
    return xml('<Response>\n  <Say voice="alice">Sorry, that number was not valid. Goodbye.</Say>\n  <Hangup/>\n</Response>');
  }
  const body =
    '<Response>\n' +
    '  <Say voice="alice">Connecting your call now.</Say>\n' +
    `  <Dial callerId="${esc(callerId)}" answerOnBridge="true" timeout="30">\n` +
    `    <Number>${esc(to)}</Number>\n` +
    '  </Dial>\n' +
    '</Response>';
  return xml(body);
};
