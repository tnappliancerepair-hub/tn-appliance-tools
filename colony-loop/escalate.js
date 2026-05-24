import * as sms from './sms.js';
import * as xano from './xano.js';

export async function escalate({ originalSignalId, question, options = ['approve', 'reject'], details = '' }) {
  const lines = [
    '[ant] need decision',
    question,
  ];
  if (details) lines.push(details);
  lines.push(`reply: ${options.join(' / ')}  (sig ${originalSignalId})`);

  const body = lines.join('\n');
  const smsRes = await sms.toOwner(body, {
    action: 'escalation_request',
    original_signal_id: originalSignalId,
    options,
  });

  await xano.emitSignal({
    signal_type: 'ESCALATION_PENDING',
    signal_strength: 90,
    payload: {
      original_signal_id: originalSignalId,
      question,
      options,
      sms_status: smsRes,
    },
  });

  return { escalated: true, awaiting: 'owner_decision', sms: smsRes };
}
