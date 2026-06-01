// Vapi voicemail webhook receiver. Configure in the Vapi dashboard on
// the Ant Inbound agent: end-of-call event → POST to this URL when the
// call ended in a "leave a message" outcome.
//
// Maps Vapi's payload shape to our Xano record_vapi_voicemail endpoint.
// Vapi may send several event types; we filter to end-of-call where a
// voicemail was captured.

const XANO_INTAKE = process.env.XANO_INTAKE_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'method not allowed' };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, body: 'invalid json' };
  }

  const msg = body.message || body;
  const callerPhone =
    (msg.customer && msg.customer.number) ||
    msg.caller_phone ||
    msg.from ||
    msg.phoneNumber ||
    '';

  const transcript =
    msg.transcript ||
    msg.voicemail_transcript ||
    (msg.artifact && msg.artifact.transcript) ||
    '';

  if (!callerPhone || !transcript) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, skipped: true, reason: 'no_voicemail_payload' }),
    };
  }

  const vapiCallId = msg.call_id || msg.callId || (msg.call && msg.call.id) || '';
  const durationSeconds = parseInt(msg.duration_seconds || msg.durationSeconds || 0, 10);
  const intent = String(msg.intent || msg.endedReason || '').slice(0, 100);

  try {
    const r = await fetch(`${XANO_INTAKE}/record_vapi_voicemail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caller_phone: callerPhone,
        transcript: transcript,
        vapi_call_id: vapiCallId,
        duration_seconds: durationSeconds,
        intent: intent,
      }),
    });
    const upstream = await r.json().catch(() => ({}));
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, upstream }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: String(e.message || e) }),
    };
  }
};
