// Vapi voice-assistant webhook receiver. Wired to inbound calls on the
// vanity numbers 1-888-ANT-8998 + 1-866-ANT-0111 (operator config in
// Vapi dashboard).
//
// Events handled:
//   - call-start  → record inbound call attempt
//   - call-end    → record transcript + emit VAPI_CALL_COMPLETED signal
//                  → downstream agents create job intake, alert office, etc
//
// Always returns 200 so Vapi doesn't retry.

const XANO_RECORD_VAPI = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/record_vapi_call';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 200, body: 'ack' }; }

  const msg = (body && body.message) || body;
  const type = String(msg.type || msg.event || '').toLowerCase();
  const call = msg.call || {};
  const callerNumber = String(call.customer && call.customer.number || msg.from || '').trim();
  const calledNumber = String(call.phoneNumber && call.phoneNumber.number || msg.to || '').trim();
  const callId = String(call.id || msg.call_id || '').trim();

  if (!callerNumber) {
    return { statusCode: 200, body: 'ack' };
  }

  // For call-end events, the transcript is available
  let transcript = '';
  let summary = '';
  if (type === 'call-end' || type === 'end-of-call-report' || type === 'end-of-call') {
    transcript = String(msg.transcript || msg.summary || '').slice(0, 4000);
    summary = String(msg.summary || msg.endedReason || '').slice(0, 500);
  }

  try {
    await fetch(XANO_RECORD_VAPI, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        caller_number: callerNumber,
        called_number: calledNumber,
        vapi_call_id: callId,
        event_type: type,
        transcript,
        summary,
      }),
    });
  } catch (err) {
    console.warn('[vapi-webhook] xano forward failed', err.message);
  }

  return { statusCode: 200, body: 'ack' };
};
