// Handles UPSELL_DUE signals (emitted by appointment_scheduled.js with
// deadline = scheduled_start - 24h). Sends customer a pre-appointment
// upsell SMS suggesting an appliance audit while the tech is there.
//
// Per-job dedup so re-emitted signals don't re-send.
import { config } from '../config.js';
import { normalizeE164, toCustomer } from '../sms.js';

const UPSELL_VARIANTS = [
  appliance => `Hi {first}! Quick note: while {tech} is over for your ${appliance} tomorrow, we can also check any other appliances in the home for $49 (regularly $99). Reply YES to add it on. -TN Appliance`,
  appliance => `Hey {first} - while {tech} is at your place tomorrow for the ${appliance}, want us to do a quick 27-point check on your other appliances? $49 add-on. Reply YES if interested. -TN Appliance`,
];

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const phone = String(payload.customer_phone || '').trim();
  const firstName = String(payload.first_name || '').trim() || 'there';
  const techFirst = String(payload.tech_first || '').trim() || 'our tech';
  const appliance = String(payload.appliance_type || 'appliance').toLowerCase();
  const deadlineMs = Number(payload.deadline_ms || payload.scheduled_for_ms || 0);
  const scheduledStartMs = Number(payload.scheduled_start_ms || 0);

  if (!jobId || !phone || !deadlineMs) {
    await xano.markSignalProcessed(signal.id, 'upsell_due_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  // Hold-and-re-emit
  if (Date.now() < deadlineMs) {
    try {
      await xano.emitSignal({ signal_type: 'UPSELL_DUE', signal_strength: 35, payload });
    } catch (err) {
      log('upsell_due_hold_failed', { job_id: jobId, error: String(err.message || err) });
    }
    await xano.markSignalProcessed(signal.id, 'upsell_due_handled', {
      outcome: 'held_until_deadline',
      deadline_ms: deadlineMs,
    });
    return { success: true, action: 'held_until_deadline' };
  }

  // Per-job dedup
  const dedupAction = `upsell_due_sent_${jobId}_${scheduledStartMs}`;
  let priorSend = null;
  try {
    priorSend = await xano.getEventLogByAction(dedupAction);
  } catch (err) { /* fail-open */ }
  if (priorSend && priorSend.exists) {
    await xano.markSignalProcessed(signal.id, 'upsell_due_handled', {
      outcome: 'skipped_already_sent',
    });
    return { success: true, action: 'skipped_already_sent' };
  }

  const normPhone = normalizeE164(phone);
  if (!normPhone) {
    await xano.markSignalProcessed(signal.id, 'upsell_due_handled', { outcome: 'skipped_no_phone' });
    return { success: false, action: 'skipped_no_phone' };
  }

  // Pick a variant based on job_id for A/B testing
  const variant = UPSELL_VARIANTS[jobId % UPSELL_VARIANTS.length];
  const body = variant(appliance)
    .replace('{first}', firstName)
    .replace('{tech}', techFirst);

  let smsRes = null;
  try {
    smsRes = await toCustomer(normPhone, body, {
      action: 'upsell_due_sent',
      job_id: jobId,
      variant: jobId % UPSELL_VARIANTS.length,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  try {
    await xano.recordEventLog(dedupAction, {
      job_id: jobId,
      variant: jobId % UPSELL_VARIANTS.length,
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    });
  } catch (err) { /* ignore */ }

  const meta = {
    job_id: jobId,
    outcome: smsRes && smsRes.success ? 'sent' : 'send_failed',
  };
  await xano.markSignalProcessed(signal.id, 'upsell_due_handled', meta);
  log('upsell_due_handled', meta);
  return { success: true, action: meta.outcome };
}
