// Handles CANCEL_FOLLOWUP signals (emitted by job_canceled.js with
// deadline = now + 24h). Hold-and-re-emit pattern. At deadline, sends
// the customer a rescue-outreach SMS:
//
//   "Hi {first}, did you find another tech for your {appliance}? If
//    you'd still like our help, reply YES and we'll get you on the
//    calendar. -TN Appliance"
//
// Skip cases:
//   - customer has since rebooked another job (any job for them created
//     after the cancel) → silent skip
//   - no phone → silent skip
//   - already followed up (compound action dedup) → silent skip
import { config } from '../config.js';
import { toCustomer } from '../sms.js';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const customerId = Number(payload.customer_id || 0);
  const phone = String(payload.customer_phone || '').trim();
  const firstName = String(payload.first_name || '').trim() || 'there';
  const appliance = String(payload.appliance_type || 'appliance').toLowerCase();
  const deadlineMs = Number(payload.deadline_ms || payload.scheduled_for_ms || 0);

  if (!jobId || !phone || !deadlineMs) {
    await xano.markSignalProcessed(signal.id, 'cancel_followup_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  // Hold-and-re-emit
  if (Date.now() < deadlineMs) {
  // Dedup: if multiple pending signals exist for this job, skip the
  // re-emit and mark current processed. Collapses runaway dupes over a
  // few ticks back to steady-state 1 pending per job. Prevents the
  // duplicate-SMS-at-deadline bug.
  try {
    const counts = await xano.countPendingSignalsForJob('CANCEL_FOLLOWUP', jobId);
    if (counts && counts.pending_count > 1) {
      log('dedup_skip_reemit', { job_id: jobId, pending_count: counts.pending_count, type: 'CANCEL_FOLLOWUP' });
      await xano.markSignalProcessed(signal.id, 'cancel_followup_handled', {
        job_id: jobId, outcome: 'dedup_skip_reemit', pending_count: counts.pending_count,
      });
      return { success: true, action: 'dedup_skip_reemit', job_id: jobId };
    }
  } catch (e) {
    log('dedup_check_failed', { job_id: jobId, type: 'CANCEL_FOLLOWUP', error: String(e.message || e) });
  }

    try {
      await xano.emitSignal({
        signal_type: 'CANCEL_FOLLOWUP',
        signal_strength: 45,
        payload,
      });
    } catch (err) {
      log('cancel_followup_hold_failed', { job_id: jobId, error: String(err.message || err) });
    }
    await xano.markSignalProcessed(signal.id, 'cancel_followup_handled', {
      outcome: 'held_until_deadline',
      deadline_ms: deadlineMs,
    });
    return { success: true, action: 'held_until_deadline', job_id: jobId };
  }

  // Compound dedup — same canceled job shouldn't double-follow-up
  const dedupAction = `cancel_followup_sent_${jobId}`;
  let priorSend = null;
  try {
    priorSend = await xano.getEventLogByAction(dedupAction);
  } catch (err) {
    log('cancel_followup_dedup_failed', { job_id: jobId, error: String(err.message || err) });
  }
  if (priorSend && priorSend.exists) {
    await xano.markSignalProcessed(signal.id, 'cancel_followup_handled', {
      outcome: 'skipped_already_sent',
      last_at: priorSend.last_at,
    });
    return { success: true, action: 'skipped_already_sent', job_id: jobId };
  }

  // Customer-rebooked check — if a newer job exists for this customer,
  // they've probably already moved on. Skip the rescue outreach.
  if (customerId > 0) {
    try {
      const prior = await xano.getPriorVisitsForCustomer(customerId, appliance, jobId, 1); // ~30 days
      const newer = (prior && prior.prior_visits || []).filter((v) => {
        const created = Number(v.created_at || 0);
        return created > (signal.created_at_ms || 0); // approximated: any visit newer than the cancel signal
      });
      if (newer.length > 0) {
        const meta = {
          job_id: jobId,
          outcome: 'skipped_customer_rebooked',
          rebooked_job_id: newer[0].id,
        };
        await xano.markSignalProcessed(signal.id, 'cancel_followup_handled', meta);
        log('cancel_followup_handled', meta);
        return { success: true, action: 'skipped_customer_rebooked', job_id: jobId };
      }
    } catch (err) {
      log('cancel_followup_rebook_check_failed', { job_id: jobId, error: String(err.message || err) });
      // Fail-open — still send the followup
    }
  }

  const last4 = String(phone).replace(/\D/g, '').slice(-4);
  const portalClause = last4
    ? ` Reschedule: ${bareDomain()}/customer-portal.html?job_id=${jobId}&last4=${last4}`
    : '';

  const body =
    `Hi ${firstName} - we wanted to follow up on your canceled ${appliance} appointment. ` +
    `Did you find another tech, or would you like us to get you back on the calendar? ` +
    `Reply YES if interested, or call 866-268-0111.${portalClause}`;

  let smsRes = null;
  try {
    smsRes = await toCustomer(phone, body, {
      action: 'cancel_followup_sent',
      job_id: jobId,
      customer_id: customerId,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  // Write compound dedup row
  try {
    await xano.recordEventLog(dedupAction, {
      job_id: jobId,
      customer_id: customerId,
      customer_phone: phone,
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
      source_signal_id: signal.id,
    });
  } catch (err) {
    log('cancel_followup_dedup_write_failed', { job_id: jobId, error: String(err.message || err) });
  }

  const meta = {
    job_id: jobId,
    outcome: smsRes && smsRes.success ? 'sent' : 'send_failed',
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'cancel_followup_handled', meta);
  log('cancel_followup_handled', meta);

  return { success: true, action: meta.outcome, job_id: jobId };
}
