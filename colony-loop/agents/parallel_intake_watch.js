// PARALLEL INTAKE WATCH
//
// Fires hourly during 8am-9pm CT via tick.js. Looks for
// parallel_job_created_from_email rows in the last LOOKBACK_HRS hours.
// If zero rows landed during expected-traffic hours, SMSes Teddy + sends
// a recovery SMS when intake comes back.
//
// Catches the scenario where the AHS / ServicePower Gmail pollers stop
// fetching mail (auth expired, Gmail API throttled, parser crashed,
// rate-limited, etc.). Without this, we silently lose customer leads.
//
// Recovery semantics:
//   * Alert on first observation that intake has been dead >LOOKBACK_HRS
//     during business hours.
//   * 60 min dedup so a sustained outage doesn't spam.
//   * Recovery SMS fires when the next watch detects a new intake row
//     after a prior alert.
//   * Stateless via event_log markers (parallel_intake_alert /
//     parallel_intake_recovered).

import { listRecentEventLog, recordEvent } from '../xano.js';

const LOOKBACK_HRS = 2;
const REALERT_COOLDOWN_MS = 60 * 60 * 1000;

async function recentIntakeCount(lookbackMs) {
  let rows = [];
  try {
    rows = await listRecentEventLog({ action: 'parallel_job_created_from_email', days_back: 1, limit: 500 });
  } catch (_) {}
  const cutoff = Date.now() - lookbackMs;
  return (rows || []).filter(r => (r.created_at || 0) >= cutoff).length;
}

async function lastAlertTs() {
  let rows = [];
  try {
    rows = await listRecentEventLog({ action: 'parallel_intake_alert', days_back: 1, limit: 50 });
  } catch (_) {}
  return (rows || []).reduce((a, r) => Math.max(a, r.created_at || 0), 0);
}

async function lastRecoveryTs() {
  let rows = [];
  try {
    rows = await listRecentEventLog({ action: 'parallel_intake_recovered', days_back: 1, limit: 50 });
  } catch (_) {}
  return (rows || []).reduce((a, r) => Math.max(a, r.created_at || 0), 0);
}

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const lookbackMs = LOOKBACK_HRS * 60 * 60 * 1000;
  const count = await recentIntakeCount(lookbackMs);

  const wasFailingBefore = (await lastAlertTs()) > (await lastRecoveryTs());

  let alerted = false;
  let recovered = false;

  if (count === 0) {
    const lastAlert = await lastAlertTs();
    const cooldownOk = (Date.now() - lastAlert) > REALERT_COOLDOWN_MS;
    if (cooldownOk) {
      const body = `[ant] no parallel intake jobs in last ${LOOKBACK_HRS}h. AHS/SP pollers may be stuck. Check Gmail OAuth + colony-loop logs.`;
      try { await sms.toOwner(body, { call_site: 'parallel_intake_watch_alert' }); } catch (_) {}
      try { await recordEvent('parallel_intake_alert', { lookback_hrs: LOOKBACK_HRS, count_observed: 0 }); } catch (_) {}
      alerted = true;
    }
  } else if (count > 0 && wasFailingBefore) {
    try { await sms.toOwner(`[ant] parallel intake recovered — ${count} new jobs in last ${LOOKBACK_HRS}h`, { call_site: 'parallel_intake_watch_recovery' }); } catch (_) {}
    try { await recordEvent('parallel_intake_recovered', { lookback_hrs: LOOKBACK_HRS, count_observed: count }); } catch (_) {}
    recovered = true;
  }

  await xano.markSignalProcessed(signal.id, 'parallel_intake_watch_handled', {
    count_observed: count,
    lookback_hrs: LOOKBACK_HRS,
    alerted,
    recovered,
  });
  log('parallel_intake_watch_done', { count, alerted, recovered });
  return { success: true, count, alerted, recovered };
}
