// Hooks JOB_CREATED. If the same customer had a prior job completed
// within the last 30 days for the same appliance_type, this is likely
// a callback (the previous fix didn't hold or didn't address the real
// problem). Alert Teddy + write a callback_event row for analytics.
//
// Why this matters: callbacks are the #1 unforced error in appliance
// repair. The tech fixed the wrong thing → customer churns. Catching
// callbacks at intake time gives Teddy the option to assign the SAME
// tech who did the original visit, or pre-brief the new tech on what
// was tried before.
//
// Listens for: JOB_CREATED (already emitted by 6+ producer endpoints)
// Skip cases:
//   - customer_id missing (anonymous intake)
//   - no prior completed job in window
//   - this is the FIRST job for this customer (job_count <= 1)
//
// Uses get_prior_visits_for_customer (already exists) for the lookup.
import { config } from '../config.js';
import { toOwner } from '../sms.js';

const CALLBACK_WINDOW_MONTHS = 1; // 30 days

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const customerId = Number(payload.customer_id || 0);
  const customerFirst = String(payload.customer_first_name || payload.first_name || '').trim();
  const applianceType = String(payload.appliance_type || payload.appliance || '').toLowerCase().trim();

  if (!jobId || !customerId || !applianceType) {
    await xano.markSignalProcessed(signal.id, 'callback_check_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  let prior;
  try {
    prior = await xano.getPriorVisitsForCustomer(customerId, applianceType, jobId, CALLBACK_WINDOW_MONTHS);
  } catch (err) {
    log('callback_check_lookup_failed', { job_id: jobId, error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'callback_check_handled', {
      outcome: 'lookup_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'lookup_failed' };
  }

  const visits = (prior && prior.prior_visits) || [];
  // Filter to terminal-completed visits only (not canceled, not still-in-flight)
  const completed = visits.filter((v) => {
    const s = String(v.scheduling_status || '').toLowerCase();
    return s === 'completed' || s === 'awaiting_parts' || s === 'held';
  });

  if (completed.length === 0) {
    const meta = { job_id: jobId, customer_id: customerId, outcome: 'no_prior_completed', appliance: applianceType };
    await xano.markSignalProcessed(signal.id, 'callback_check_handled', meta);
    log('callback_check_handled', meta);
    return { success: true, action: 'no_prior_completed', job_id: jobId };
  }

  // Sort by recency (most recent first)
  completed.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
  const mostRecent = completed[0];
  const priorJobId = Number(mostRecent.id);
  const priorTechId = Number(mostRecent.technician_id || 0);
  const priorStatus = String(mostRecent.scheduling_status || '');
  const priorCompletedMs = Number(mostRecent.job_completed_at || mostRecent.created_at || 0);
  const daysAgo = priorCompletedMs > 0 ? Math.round((Date.now() - priorCompletedMs) / (24 * 60 * 60 * 1000)) : null;

  const first = customerFirst || 'customer';
  const daysClause = daysAgo != null ? `${daysAgo} day${daysAgo === 1 ? '' : 's'} ago` : 'recently';
  const techClause = priorTechId > 0 ? ` by tech #${priorTechId}` : '';
  const statusClause = priorStatus !== 'completed' ? ` (left as ${priorStatus.replace(/_/g, ' ')})` : '';
  const reviewUrl = `${bareDomain()}/job-detail.html?job_id=${priorJobId}&office=1`;

  const body =
    `[ant] ⚠️ CALLBACK RISK on job #${jobId} — ${first}'s ${applianceType} again. ` +
    `Last visit ${daysClause}${techClause}${statusClause}. Review prior job: ${reviewUrl}`;

  let smsRes = null;
  try {
    smsRes = await toOwner(body, {
      action: 'callback_alert_sent',
      job_id: jobId,
      customer_id: customerId,
      prior_job_id: priorJobId,
      prior_tech_id: priorTechId,
      days_since_prior: daysAgo,
      source_signal_id: signal.id,
    });
  } catch (err) {
    log('callback_alert_sms_failed', { job_id: jobId, error: String(err.message || err) });
    smsRes = { success: false, error: String(err.message || err) };
  }

  // Write callback_event row for analytics (separate from the dedup row
  // markSignalProcessed produces).
  try {
    await xano.recordEventLog('callback_event_logged', {
      job_id: jobId,
      customer_id: customerId,
      prior_job_id: priorJobId,
      prior_tech_id: priorTechId,
      days_since_prior: daysAgo,
      appliance_type: applianceType,
      prior_status: priorStatus,
    });
  } catch (err) {
    log('callback_event_log_failed', { job_id: jobId, error: String(err.message || err) });
  }

  const meta = {
    job_id: jobId,
    customer_id: customerId,
    outcome: smsRes && smsRes.success ? 'alert_sent' : 'alert_failed',
    prior_job_id: priorJobId,
    prior_tech_id: priorTechId,
    days_since_prior: daysAgo,
    prior_status: priorStatus,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'callback_check_handled', meta);
  log('callback_check_handled', meta);
  return { success: true, action: meta.outcome, job_id: jobId, prior_job_id: priorJobId };
}
