// Handles MAINTENANCE_REMINDER_DUE signals (emitted by job_completed.js
// with deadline = now + 180 days for completed repair jobs). Hold-and-
// re-emit until deadline, then SMS the customer suggesting a check-up.
import { config } from '../config.js';
import { normalizeE164, toCustomer } from '../sms.js';

const TEMPLATES = {
  refrigerator: (first, when) => `Hi ${first} - it's been ${when} since we fixed your refrigerator. Want us to swing by for a coil-clean + cooling check? Reply YES if interested. -TN Appliance`,
  fridge:       (first, when) => `Hi ${first} - it's been ${when} since we fixed your refrigerator. Want us to swing by for a coil-clean + cooling check? Reply YES if interested. -TN Appliance`,
  washer:       (first, when) => `Hi ${first} - it's been ${when} since we fixed your washer. Want us to swing by for a hose + drain check? Reply YES if interested. -TN Appliance`,
  dryer:        (first, when) => `Hi ${first} - it's been ${when} since we fixed your dryer. Want us to clean the vent + check the lint trap? Reply YES if interested. -TN Appliance`,
  dishwasher:   (first, when) => `Hi ${first} - it's been ${when} since we fixed your dishwasher. Want us to descale + check the spray arms? Reply YES if interested. -TN Appliance`,
  default:      (first, when, appl) => `Hi ${first} - it's been ${when} since we fixed your ${appl}. Want us to do a quick check-up? Reply YES if interested. -TN Appliance`,
};

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const customerId = Number(payload.customer_id || 0);
  const phone = String(payload.customer_phone || '').trim();
  const firstName = String(payload.first_name || '').trim() || 'there';
  const applianceType = String(payload.appliance_type || 'appliance').toLowerCase();
  const deadlineMs = Number(payload.deadline_ms || payload.scheduled_for_ms || 0);

  if (!jobId || !phone || !deadlineMs) {
    await xano.markSignalProcessed(signal.id, 'maintenance_reminder_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  // Hold-and-re-emit
  if (Date.now() < deadlineMs) {
    try {
      await xano.emitSignal({ signal_type: 'MAINTENANCE_REMINDER_DUE', signal_strength: 30, payload });
    } catch (err) {
      log('maintenance_reminder_hold_failed', { job_id: jobId, error: String(err.message || err) });
    }
    await xano.markSignalProcessed(signal.id, 'maintenance_reminder_handled', {
      outcome: 'held_until_deadline',
      deadline_ms: deadlineMs,
    });
    return { success: true, action: 'held_until_deadline' };
  }

  // Per-customer dedup (don't send 2 reminders if multiple jobs queued)
  const dedupAction = `maintenance_reminder_sent_customer_${customerId}_${Math.floor(Date.now() / (180 * 24 * 60 * 60 * 1000))}`;
  let priorSend = null;
  try {
    priorSend = await xano.getEventLogByAction(dedupAction);
  } catch (err) { /* fail-open */ }
  if (priorSend && priorSend.exists) {
    await xano.markSignalProcessed(signal.id, 'maintenance_reminder_handled', {
      outcome: 'skipped_window_dedup',
    });
    return { success: true, action: 'skipped_window_dedup' };
  }

  const normPhone = normalizeE164(phone);
  if (!normPhone) {
    await xano.markSignalProcessed(signal.id, 'maintenance_reminder_handled', {
      outcome: 'skipped_no_phone',
    });
    return { success: false, action: 'skipped_no_phone' };
  }

  const template = TEMPLATES[applianceType] || TEMPLATES.default;
  const when = '6 months';
  const body = template.length >= 3
    ? template(firstName, when, applianceType)
    : template(firstName, when);

  let smsRes = null;
  try {
    smsRes = await toCustomer(normPhone, body, {
      action: 'maintenance_reminder_sent',
      job_id: jobId,
      customer_id: customerId,
      appliance_type: applianceType,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  try {
    await xano.recordEventLog(dedupAction, {
      job_id: jobId,
      customer_id: customerId,
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    });
  } catch (err) { /* ignore */ }

  const meta = {
    job_id: jobId,
    outcome: smsRes && smsRes.success ? 'sent' : 'send_failed',
  };
  await xano.markSignalProcessed(signal.id, 'maintenance_reminder_handled', meta);
  log('maintenance_reminder_handled', meta);
  return { success: true, action: meta.outcome };
}
