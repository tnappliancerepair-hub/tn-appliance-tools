import { config } from '../config.js';
import { isQuietHourCT, next8amCTMs, fmtCT } from '../time.js';
import { normalizeE164 } from '../sms.js';

const APPLIANCE_NICE = {
  refrigerator: 'refrigerator',
  fridge: 'refrigerator',
  washer: 'washer',
  dryer: 'dryer',
  dishwasher: 'dishwasher',
  range: 'range',
  oven: 'oven',
  stove: 'stove',
  microwave: 'microwave',
};

const CASH_SOURCES = new Set(['cash_tdr', 'self_pay', 'cash', 'customer_pay', 'cash_customer']);

function shouldIncludeWarrantyNote(source) {
  const s = String(source || '').toLowerCase();
  return !CASH_SOURCES.has(s);
}

function composeGreeting({ first_name, appliance_type, source }) {
  const name = (first_name || '').trim() || 'there';
  const applianceRaw = (appliance_type || '').trim().toLowerCase();
  const appliance = APPLIANCE_NICE[applianceRaw] || applianceRaw;
  const applianceClause = appliance ? `your ${appliance} repair` : 'your repair';
  const link = config.publicSiteBase.replace(/^https?:\/\//, '');
  let body = `Hi ${name}, this is TN Appliance Exchange! To get ${applianceClause} started please tap here: ${link}`;
  if (shouldIncludeWarrantyNote(source)) {
    body += `\n\nYour repair is covered under your home warranty - no payment needed. Just mention warranty if asked.`;
  }
  return body;
}

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const payload = signal.payload || {};

  const jobId = Number(payload.job_id);
  if (!jobId) throw new Error('payload.job_id required');

  if (payload.scheduled_for_ms && Date.now() < Number(payload.scheduled_for_ms)) {
    await xano.emitSignal({
      signal_type: 'JOB_CREATED',
      signal_strength: 70,
      payload,
    });
    return {
      success: true,
      action: 'held_still_quiet',
      job_id: jobId,
      wake_at_ms: payload.scheduled_for_ms,
    };
  }

  const phone = normalizeE164(payload.customer_phone);
  if (!phone) {
    return { success: false, action: 'skipped', reason: 'invalid_phone', job_id: jobId };
  }

  const greetingCheck = await xano.getGreetingSentForJob(jobId);
  if (greetingCheck && greetingCheck.sent) {
    return { success: true, action: 'skipped_duplicate', job_id: jobId, last_sent_at: greetingCheck.last_sent_at };
  }

  if (isQuietHourCT(Date.now(), config.quietStartHourCT, config.quietEndHourCT)) {
    const wakeAt = next8amCTMs();
    await xano.emitSignal({
      signal_type: 'JOB_CREATED',
      signal_strength: 70,
      payload: {
        ...payload,
        held_at: Date.now(),
        scheduled_for_ms: wakeAt,
        held_reason: 'quiet_hours',
      },
    });
    log('greeting_held_quiet_hours', { job_id: jobId, wake_at: fmtCT(wakeAt) });
    return {
      success: true,
      action: 'held_for_quiet_hours',
      job_id: jobId,
      wake_at_ms: wakeAt,
    };
  }

  const body = composeGreeting({
    first_name: payload.customer_first_name,
    appliance_type: payload.appliance_type,
    source: payload.source,
  });

  const smsRes = await sms.toCustomer(phone, body, {
    action: 'new_job_greeting',
    job_id: jobId,
    source_signal_id: signal.id,
    source: payload.source || 'unknown',
  });

  await xano.markSignalProcessed(signal.id, 'new_job_greeting_sent', {
    job_id: jobId,
    phone,
    source: payload.source,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  });

  return {
    success: true,
    action: 'greeting_sent',
    job_id: jobId,
    phone,
  };
}
