// XANO API WATCH
//
// Fires every 15 min via tick.js. Probes a known-cheap Xano endpoint
// with a 5-sec timeout. Alerts on two consecutive failures so a single
// flaky tick doesn't false-alarm.
//
// Catches Xano-side outages (n7e instance hiccup, deploy in progress,
// rate-limit, certificate expiry). When Xano is down, the entire system
// is affected — every other agent fails silently, customer-facing pages
// can't load, scheduling is dead. We want to know within ~30 min.
//
// State machine via event_log markers:
//   xano_api_probe_ok       — most recent probe succeeded
//   xano_api_probe_fail     — most recent probe failed
//   xano_api_alert          — alert sent (two consecutive fails)
//   xano_api_recovered      — recovery sent after prior alert
//
// The "two consecutive fails" check looks at the last two probe outcomes
// in chronological order.

import { listRecentEventLog, recordEvent } from '../xano.js';

const PROBE_URL = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/get_capacity_check_fired_today';
const PROBE_TIMEOUT_MS = 5000;
const REALERT_COOLDOWN_MS = 30 * 60 * 1000;

async function probeXano() {
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  const startedMs = Date.now();
  try {
    const r = await fetch(PROBE_URL, { signal: ac.signal });
    clearTimeout(tid);
    const elapsed = Date.now() - startedMs;
    if (r.status >= 200 && r.status < 500) {
      // 200, 400, 404 are all "Xano is responding". Only 5xx or no
      // response counts as a failure for this watch.
      return { ok: true, elapsed, status: r.status };
    }
    return { ok: false, elapsed, status: r.status, reason: `http_${r.status}` };
  } catch (err) {
    clearTimeout(tid);
    return { ok: false, elapsed: Date.now() - startedMs, reason: String(err.message || err) };
  }
}

async function lastTwoProbeOutcomes() {
  let okRows = [];
  let failRows = [];
  try {
    okRows = await listRecentEventLog({ action: 'xano_api_probe_ok', days_back: 1, limit: 50 });
  } catch (_) {}
  try {
    failRows = await listRecentEventLog({ action: 'xano_api_probe_fail', days_back: 1, limit: 50 });
  } catch (_) {}
  const merged = []
    .concat(okRows.map(r => ({ ts: r.created_at || 0, ok: true })))
    .concat(failRows.map(r => ({ ts: r.created_at || 0, ok: false })))
    .sort((a, b) => b.ts - a.ts);
  return merged.slice(0, 2);
}

async function lastAlertTs() {
  let rows = [];
  try {
    rows = await listRecentEventLog({ action: 'xano_api_alert', days_back: 1, limit: 50 });
  } catch (_) {}
  return (rows || []).reduce((a, r) => Math.max(a, r.created_at || 0), 0);
}

async function lastRecoveryTs() {
  let rows = [];
  try {
    rows = await listRecentEventLog({ action: 'xano_api_recovered', days_back: 1, limit: 50 });
  } catch (_) {}
  return (rows || []).reduce((a, r) => Math.max(a, r.created_at || 0), 0);
}

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const probe = await probeXano();

  // Record this probe outcome BEFORE checking history, so the "two
  // consecutive" check includes this one.
  try {
    await recordEvent(probe.ok ? 'xano_api_probe_ok' : 'xano_api_probe_fail', {
      elapsed_ms: probe.elapsed,
      status: probe.status,
      reason: probe.reason || null,
    });
  } catch (_) {}

  const wasFailingBefore = (await lastAlertTs()) > (await lastRecoveryTs());
  let alerted = false;
  let recovered = false;

  if (!probe.ok) {
    // Did the previous probe also fail?
    const lastTwo = await lastTwoProbeOutcomes();
    const consecutiveFails = lastTwo.length >= 2 && !lastTwo[0].ok && !lastTwo[1].ok;
    const cooldownOk = (Date.now() - (await lastAlertTs())) > REALERT_COOLDOWN_MS;
    if (consecutiveFails && cooldownOk) {
      try { await sms.toOwner(`[ant] Xano API not responding — 2 consecutive probe failures (${probe.reason || 'fail'}). Site + scheduling may be degraded.`, { call_site: 'xano_api_watch_alert' }); } catch (_) {}
      try { await recordEvent('xano_api_alert', { reason: probe.reason, status: probe.status, elapsed_ms: probe.elapsed }); } catch (_) {}
      alerted = true;
    }
  } else if (probe.ok && wasFailingBefore) {
    try { await sms.toOwner(`[ant] Xano API recovered — probe back to ${probe.status} in ${probe.elapsed}ms`, { call_site: 'xano_api_watch_recovery' }); } catch (_) {}
    try { await recordEvent('xano_api_recovered', { status: probe.status, elapsed_ms: probe.elapsed }); } catch (_) {}
    recovered = true;
  }

  await xano.markSignalProcessed(signal.id, 'xano_api_watch_handled', {
    ok: probe.ok,
    elapsed_ms: probe.elapsed,
    status: probe.status,
    alerted,
    recovered,
  });
  log('xano_api_watch_done', { ok: probe.ok, elapsed_ms: probe.elapsed, alerted, recovered });
  return { success: true, ok: probe.ok, alerted, recovered };
}
