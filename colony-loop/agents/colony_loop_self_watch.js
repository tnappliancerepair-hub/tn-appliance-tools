// COLONY LOOP SELF WATCH
//
// Fires every 10 min via tick.js. Confirms the loop is not just alive
// but actually processing signals + producing events. Counts how many
// event_log rows landed in the last 10 minutes. Under normal traffic
// the loop produces dozens of events (signal_dispatched,
// signal_processed, *_handled, etc). A count below MIN_EXPECTED is a
// strong signal that something is stuck.
//
// Limitations:
//   * If the loop is completely dead, this agent will not fire either
//     (no signals get processed). For the "process is dead" case, the
//     launchd KeepAlive=true config restarts the binary, and the
//     external marketing_site_watch catches downstream effects.
//   * This watch specifically catches "loop is alive but stuck" —
//     deadlocks, hung agents, lost connection to Xano.
//
// Recovery semantics:
//   * Alert when event_log count over last 10 min drops below
//     MIN_EXPECTED (default 5, low enough to avoid noise during quiet
//     overnight hours but high enough to catch a stall).
//   * 30 min dedup so a sustained issue doesn't spam.
//   * Recovery SMS when count comes back above MIN_EXPECTED after a
//     prior alert.

import { listRecentEventLog, recordEvent } from '../xano.js';

const WINDOW_MS = 10 * 60 * 1000;
const MIN_EXPECTED = 5;
const REALERT_COOLDOWN_MS = 30 * 60 * 1000;

async function recentEventCount() {
  // Use a broad-action listing. The most consistent high-volume actions
  // are colony_signal_emitted and signal_processed.
  let total = 0;
  for (const action of ['colony_signal_emitted', 'signal_processed']) {
    let rows = [];
    try {
      rows = await listRecentEventLog({ action, days_back: 1, limit: 200 });
    } catch (_) {}
    const cutoff = Date.now() - WINDOW_MS;
    total += (rows || []).filter(r => (r.created_at || 0) >= cutoff).length;
  }
  return total;
}

async function lastAlertTs() {
  let rows = [];
  try {
    rows = await listRecentEventLog({ action: 'colony_loop_self_alert', days_back: 1, limit: 50 });
  } catch (_) {}
  return (rows || []).reduce((a, r) => Math.max(a, r.created_at || 0), 0);
}

async function lastRecoveryTs() {
  let rows = [];
  try {
    rows = await listRecentEventLog({ action: 'colony_loop_self_recovered', days_back: 1, limit: 50 });
  } catch (_) {}
  return (rows || []).reduce((a, r) => Math.max(a, r.created_at || 0), 0);
}

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const count = await recentEventCount();
  const wasFailingBefore = (await lastAlertTs()) > (await lastRecoveryTs());

  let alerted = false;
  let recovered = false;

  if (count < MIN_EXPECTED) {
    const lastAlert = await lastAlertTs();
    if ((Date.now() - lastAlert) > REALERT_COOLDOWN_MS) {
      try { await sms.toOwner(`[ant] colony loop processing stalled — only ${count} events in last 10 min (expected >=${MIN_EXPECTED}). Check Mac Mini.`, { call_site: 'colony_loop_self_watch_alert' }); } catch (_) {}
      try { await recordEvent('colony_loop_self_alert', { count_observed: count, window_min: 10, min_expected: MIN_EXPECTED }); } catch (_) {}
      alerted = true;
    }
  } else if (wasFailingBefore) {
    try { await sms.toOwner(`[ant] colony loop processing recovered — ${count} events in last 10 min`, { call_site: 'colony_loop_self_watch_recovery' }); } catch (_) {}
    try { await recordEvent('colony_loop_self_recovered', { count_observed: count }); } catch (_) {}
    recovered = true;
  }

  await xano.markSignalProcessed(signal.id, 'colony_loop_self_watch_handled', {
    count_observed: count,
    min_expected: MIN_EXPECTED,
    alerted,
    recovered,
  });
  log('colony_loop_self_watch_done', { count, alerted, recovered });
  return { success: true, count, alerted, recovered };
}
