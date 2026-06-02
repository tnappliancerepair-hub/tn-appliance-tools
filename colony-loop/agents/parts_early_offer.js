// Signal in: PARTS_EARLY (fired by parts_delivery_observed when delivered
// timestamp < original parts_eta_date)
// V1 observer mode: SMS Teddy "Mr Smith's parts arrived 3 days early."
// V2 will scan customer availability for today/tomorrow + tech availability
// + offer immediate insertion or customer-side reschedule-earlier.

import { config } from '../config.js';

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const p = signal.payload || {};
  const jobId = p.job_id;
  const daysEarly = p.days_early || 0;
  const customerName = p.customer_name || ('job #' + jobId);

  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'parts_early_handled', { outcome: 'no_job_id' });
    return { success: false, action: 'no_job_id' };
  }

  // Dedup — one offer per job ever
  const dedupKey = `parts_early_observed_${jobId}`;
  let recent;
  try {
    recent = await xano.findRecentEventLog
      ? await xano.findRecentEventLog(dedupKey, Date.now() - 7 * 24 * 60 * 60 * 1000)
      : null;
  } catch (_) { recent = null; }
  if (recent && recent.found) {
    await xano.markSignalProcessed(signal.id, 'parts_early_handled', { outcome: 'recent_skipped' });
    return { success: true, action: 'recent_skipped' };
  }

  const body =
    `[ant] ${customerName}'s parts arrived ${daysEarly} day${daysEarly === 1 ? '' : 's'} early. ` +
    `v1 observer: would check their availability + tech slots and offer to move installation sooner.`;

  let smsResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await sms.toOwner(body, { action: 'parts_early_observed', job_id: jobId, days_early: daysEarly });
      smsResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (err) {
      smsResult = String(err.message || err);
    }
  }

  const meta = {
    outcome: 'observed',
    job_id: jobId,
    days_early: daysEarly,
    customer_name: customerName,
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'parts_early_handled', meta);
  try { await xano.recordEventLog(dedupKey, { job_id: jobId, days_early: daysEarly }); } catch (_) {}
  log('parts_early_handled', meta);
  return { success: true, action: 'parts_early_handled' };
}
