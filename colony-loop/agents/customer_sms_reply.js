// Handles CUSTOMER_SMS_REPLY signals (emitted by any sms_response_* agent
// after it generates a reply). Sends the reply text to the customer via
// Xano's send_sms endpoint, which routes through Telnyx on the customer-
// direction number +1 615-588-9500.
//
// Why this agent: sms_response_* agents only EMIT the reply payload; they
// don't ship the SMS. Centralizing the send here means: (a) one place to
// apply quiet-hours, length, opt-out, and escalation logic; (b) future
// responders ship without needing send wiring.
//
// Escalation: when an sms_response_* agent emits with escalate=true, this
// agent still sends the reply (the responder already included a "human is
// coming" line) AND fires CUSTOMER_SMS_ESCALATE_NOTICE for downstream
// listeners (e.g. a future owner SMS that pings Teddy).

const SMS_HARD_CAP = 320; // 2 segments, generous ceiling
const SMS_TRUNCATE_SUFFIX = '... (more)';

function truncate(s) {
  const text = String(s || '').trim();
  if (text.length <= SMS_HARD_CAP) return text;
  const room = SMS_HARD_CAP - SMS_TRUNCATE_SUFFIX.length;
  return text.slice(0, Math.max(0, room)) + SMS_TRUNCATE_SUFFIX;
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const replyText = truncate(payload.reply_text || payload.body || '');
  const toPhone = payload.customer_phone || payload.phone || payload.to || '';

  if (!toPhone || !replyText) {
    const meta = {
      outcome: 'skipped_missing_phone_or_reply',
      has_phone: !!toPhone,
      reply_chars: replyText.length,
    };
    await xano.markSignalProcessed(signal.id, 'customer_sms_reply_handled', meta);
    log('customer_sms_reply_handled', meta);
    return { success: true, action: 'skipped_missing_phone_or_reply' };
  }

  let sendResult = null;
  try {
    sendResult = await xano.sendSms(toPhone, replyText, {
      action: 'customer_sms_reply',
      job_id: payload.job_id || null,
      customer_id: payload.customer_id || null,
      sms_type: payload.sms_type || '',
      source_signal_id: signal.id,
      recipient_role: 'customer',
    });
  } catch (err) {
    sendResult = { success: false, error: String(err.message || err) };
  }

  const meta = {
    outcome: sendResult && sendResult.success ? 'sms_sent' : 'send_failed',
    customer_id: payload.customer_id || 0,
    job_id: payload.job_id || 0,
    sms_type: payload.sms_type || '',
    reply_chars: replyText.length,
    escalate: !!payload.escalate,
    provider_message_id: sendResult ? (sendResult.provider_message_id || null) : null,
  };
  await xano.markSignalProcessed(signal.id, 'customer_sms_reply_handled', meta);
  log('customer_sms_reply_handled', meta);

  // Optional: emit an escalation notice so an owner-direction agent can
  // SMS Teddy. We do NOT emit it inline as an owner SMS here — that's a
  // separate concern that future tooling will own.
  if (payload.escalate) {
    try {
      await xano.emitSignal({
        signal_type: 'CUSTOMER_SMS_ESCALATE_NOTICE',
        signal_strength: 80,
        payload: {
          job_id: payload.job_id || null,
          customer_id: payload.customer_id || null,
          customer_phone: toPhone,
          sms_type: payload.sms_type || '',
          source_signal_id: signal.id,
        },
      });
    } catch (err) {
      log('customer_sms_escalate_notice_emit_failed', { error: String(err.message || err) });
    }
  }

  return { success: true, action: meta.outcome };
}
