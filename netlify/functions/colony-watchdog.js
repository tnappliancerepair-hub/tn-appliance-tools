// COLONY HEARTBEAT WATCHDOG
//
// Netlify scheduled function — runs every 5 minutes. Checks the most
// recent loop_tick event_log row from the Mac Mini. If the heartbeat
// is older than ALERT_THRESHOLD_MINUTES (default 15), SMSes Teddy
// that the colony loop is dead.
//
// Skipped the cloud-VPS-replica route ($30/mo + days of replication
// work) in favor of this: Netlify is already always-on so we get the
// monitoring for free. 80% of the SPOF mitigation, ships today, $0.
// Full warm replica can come later when revenue justifies it.
//
// Dedup: alerts trigger only once per outage. Tracks state via a
// colony_watchdog_alerted event_log row + age check.

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const ALERT_THRESHOLD_MINUTES = parseInt(process.env.COLONY_WATCHDOG_THRESHOLD_MIN || '15', 10);
const ALERT_DEDUP_HOURS = 2; // don't re-spam Teddy for 2h after first alert
const OWNER_PHONE = process.env.OWNER_PHONE_NUMBER || '+16154855795';

exports.handler = async () => {
  // 1. Most recent loop_tick
  let lastTick;
  try {
    const r = await fetch(`${XANO_BASE}/list_recent_event_log?action=loop_tick&days_back=1&limit=1`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      return ok({ status: 'check_failed', reason: 'list_recent_event_log non-2xx', code: r.status });
    }
    const data = await r.json();
    lastTick = (data.items || [])[0];
  } catch (e) {
    return ok({ status: 'check_failed', reason: 'list query error', error: e.message });
  }

  if (!lastTick) {
    return await maybeAlert('no_heartbeat_ever', {
      reason: 'No loop_tick events ever — has the loop been started?',
      severity: 'high',
    });
  }

  const lastTickMs = Number(lastTick.created_at || lastTick.created_at_ms || 0);
  const ageMin = (Date.now() - lastTickMs) / 60_000;

  if (ageMin <= ALERT_THRESHOLD_MINUTES) {
    return ok({ status: 'healthy', last_tick_age_min: Math.round(ageMin) });
  }

  return await maybeAlert('heartbeat_stale', {
    reason: `Last loop_tick was ${Math.round(ageMin)} minutes ago (threshold ${ALERT_THRESHOLD_MINUTES} min)`,
    age_min: Math.round(ageMin),
    severity: ageMin > 60 ? 'critical' : 'high',
  });
};

async function maybeAlert(scenario, details) {
  // Has Teddy already been alerted in the last ALERT_DEDUP_HOURS?
  try {
    const r = await fetch(`${XANO_BASE}/list_recent_event_log?action=colony_watchdog_alerted&days_back=1&limit=1`, {
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const data = await r.json();
      const lastAlert = (data.items || [])[0];
      if (lastAlert) {
        const lastAlertMs = Number(lastAlert.created_at || lastAlert.created_at_ms || 0);
        const ageHr = (Date.now() - lastAlertMs) / 3_600_000;
        if (ageHr < ALERT_DEDUP_HOURS) {
          return ok({ status: 'alert_skipped_dedup', scenario, last_alert_hours_ago: Math.round(ageHr * 10) / 10 });
        }
      }
    }
  } catch (_) {}

  // Compose + send SMS
  const body = `[ant] COLONY ALERT — ${details.reason}. Mac Mini may need a kick. Check: open Activity Monitor for node, or run: launchctl kickstart -k gui/$UID com.tnappliance.colony-loop`;
  let smsOk = false;
  try {
    const r = await fetch(`${XANO_BASE}/send_sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: OWNER_PHONE, message: body, context: { call_site: 'colony_watchdog', scenario } }),
      signal: AbortSignal.timeout(10_000),
    });
    smsOk = r.ok;
  } catch (_) {}

  // Audit row
  try {
    await fetch(`${XANO_BASE}/record_event_log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'colony_watchdog_alerted',
        metadata_json: JSON.stringify({ scenario, ...details, sms_ok: smsOk, alerted_at_ms: Date.now() }),
      }),
    });
  } catch (_) {}

  return ok({ status: 'alerted', scenario, sms_ok: smsOk, ...details });
}

function ok(body) {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
