// availability_nudge_due.js — step 2 of the availability cascade. ~2h after the
// greeting, if the customer still hasn't given their availability (portal or
// reply), send ONE focused follow-up text — just the availability question —
// and arm the Vapi-call escalation for ~3h later. No-ops if availability was
// already captured.
//
// Hold-and-re-emit: local store sleeps this via process_after_ms; the explicit
// hold check below is the belt-and-suspenders for the Xano store.
//
// Signal in:  AVAILABILITY_NUDGE_DUE { job_id, customer_phone, first_name,
//             appliance_type, service_state, process_after_ms }
// Signal out: AVAILABILITY_CALL_DUE (+3h)
import { config } from '../config.js';

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const p = signal.payload || {};
  const jobId = Number(p.job_id || 0);
  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'availability_nudge_due_handled', { outcome: 'no_job_id' });
    return { success: false, action: 'no_job_id' };
  }

  // Not due yet → sleep again.
  const due = Number(p.process_after_ms || 0);
  if (due && Date.now() < due) {
    await xano.emitSignal({ signal_type: 'AVAILABILITY_NUDGE_DUE', signal_strength: 40, payload: p });
    await xano.markSignalProcessed(signal.id, 'availability_nudge_held', { job_id: jobId });
    return { success: true, action: 'held' };
  }

  // Already answered → done, and don't escalate.
  const captured = await xano.getEventLogByAction(`availability_captured_${jobId}`).catch(() => null);
  if (captured && captured.exists) {
    const meta = { job_id: jobId, outcome: 'already_captured' };
    await xano.markSignalProcessed(signal.id, 'availability_nudge_due_handled', meta);
    log('availability_nudge_due_handled', meta);
    return { success: true, action: 'already_captured' };
  }

  // Focused follow-up text.
  const phone = String(p.customer_phone || '').trim();
  const first = (String(p.first_name || '').trim().split(/\s+/)[0]) || 'there';
  const appliance = String(p.appliance_type || 'appliance').toLowerCase();
  const body =
    `Hi ${first} — quick one so we can get your ${appliance} repair scheduled: ` +
    `what days/times work best for you, and are there any you absolutely can't do? ` +
    `Just reply right here. The more open you are, the sooner we can get a tech out.`;

  let sent = false;
  if (phone) {
    const r = await xano.sendSms(phone, body, {
      recipient_role: 'customer', action: 'availability_nudge',
      job_id: jobId, company_id: config.companyId,
    }).catch(() => ({ success: false }));
    sent = !!(r && r.success);
  }

  // Arm the Vapi-call escalation for +3h (only if we still don't have an answer).
  await xano.emitSignal({
    signal_type: 'AVAILABILITY_CALL_DUE',
    signal_strength: 45,
    payload: { ...p, process_after_ms: Date.now() + 3 * 60 * 60 * 1000 },
  });

  const meta = { job_id: jobId, outcome: sent ? 'nudged' : 'no_phone', escalation: 'call_armed' };
  await xano.markSignalProcessed(signal.id, 'availability_nudge_due_handled', meta);
  log('availability_nudge_due_handled', meta);
  return { success: true, action: meta.outcome, job_id: jobId };
}
