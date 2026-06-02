// Signal in: CUSTOMER_AVAILABILITY_CHANGED (from update_customer_availability_grid)
// V1 observer mode: customer just expanded their availability windows.
// Logs the change + SMS Teddy with the new flex_score so he can see the
// signal flowing. V2 will check for sooner tech slots and SMS the
// customer "we can come sooner".

import { config } from '../config.js';

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const p = signal.payload || {};
  const jobId = p.job_id;
  const flexScore = p.flex_score || 0;

  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'customer_availability_changed_handled', { outcome: 'no_job_id' });
    return { success: false, action: 'no_job_id' };
  }

  // Dedup — only one Teddy heads-up per job per hour (customer may tap
  // many blocks in quick succession; debounce at message level too)
  const dedupKey = `customer_availability_observed_${jobId}`;
  let recent;
  try {
    recent = await xano.findRecentEventLog
      ? await xano.findRecentEventLog(dedupKey, Date.now() - 60 * 60 * 1000)
      : null;
  } catch (_) { recent = null; }
  if (recent && recent.found) {
    await xano.markSignalProcessed(signal.id, 'customer_availability_changed_handled', { outcome: 'recent_skipped' });
    return { success: true, action: 'recent_skipped' };
  }

  const body =
    `[ant] job #${jobId} customer just updated availability. ` +
    `flex_score now ${flexScore}/100. ` +
    `v1 observer: would scan for sooner tech slots and offer customer.`;

  let smsResult = 'skipped_no_owner_phone';
  if (config.ownerPhone && flexScore >= 30) {  // only ping Teddy on meaningful flex changes
    try {
      const r = await sms.toOwner(body, { action: 'customer_availability_observed', job_id: jobId, flex_score: flexScore });
      smsResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (err) {
      smsResult = String(err.message || err);
    }
  } else if (flexScore < 30) {
    smsResult = 'skipped_low_flex';
  }

  const meta = {
    outcome: 'observed',
    job_id: jobId,
    flex_score: flexScore,
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'customer_availability_changed_handled', meta);
  try { await xano.recordEventLog(dedupKey, { job_id: jobId, flex_score: flexScore }); } catch (_) {}
  log('customer_availability_changed_handled', meta);
  return { success: true, action: 'customer_availability_changed_handled' };
}
