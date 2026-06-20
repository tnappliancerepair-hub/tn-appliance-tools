// COLONY HEARTBEAT WATCHDOG
//
// Netlify scheduled function — checks the most recent loop_tick
// event_log row from the Mac Mini. If older than threshold, SMSes Teddy.
//
// FIXED 2026-05-29: previous version spammed every run during outages
// because the audit row wrote AFTER send_sms, and a slow SMS could
// time out the 10s Netlify function before audit landed → no dedup
// baseline. Fix: write audit row FIRST so dedup is guaranteed, then
// SMS. Also added an exponential back-off (alerts at 30min, 1h, 2h,
// 4h, 8h, then 24h) so a multi-hour outage gets a handful of pings,
// not 20+.

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const ALERT_THRESHOLD_MINUTES = parseInt(process.env.COLONY_WATCHDOG_THRESHOLD_MIN || '8', 10);
const OWNER_PHONE = process.env.OWNER_PHONE_NUMBER || '+16154855795';

// Exponential back-off: ALWAYS at least N minutes between alerts.
// During a long outage, alert volume drops over time so Teddy isn't
// drowning. Default cadence: 30min after first alert, then 1h, 2h, 4h,
// 8h, then once a day.
const BACKOFF_STAGES_MIN = [30, 60, 120, 240, 480, 1440];

exports.handler = async () => {
  // 0. Respect an INTENTIONAL pause. If the loop was paused on purpose via the
  // phone switch (loop-control), don't cry "down" — that's not an outage.
  try {
    const pr = await fetch('https://tnapplianceexchange.net/.netlify/functions/loop-control?action=status', {
      signal: AbortSignal.timeout(5000),
    });
    if (pr.ok) {
      const ps = await pr.json();
      if (ps && ps.paused) return ok({ status: 'skipped_paused', paused_by: ps.paused_by || null });
    }
  } catch (_) {}

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
  // Find the most recent watchdog audit (any scenario) to compute
  // back-off. We look at the LAST audit row, count how many alerts
  // we've sent during this outage window, and require the matching
  // BACKOFF_STAGES_MIN gap before the next one.
  let lastAuditMs = 0;
  let alertCountThisOutage = 0;
  try {
    const r = await fetch(`${XANO_BASE}/list_recent_event_log?action=colony_watchdog_alerted&days_back=2&limit=10`, {
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const data = await r.json();
      const items = data.items || [];
      if (items.length > 0) {
        lastAuditMs = Number(items[0].created_at || items[0].created_at_ms || 0);
        // Walk back through recent audits to count how many belong to
        // the current outage. Definition of "same outage": each audit
        // is within 24h of the next-older one. Anything beyond a 24h
        // gap = different outage, reset count.
        alertCountThisOutage = 1;
        for (let i = 1; i < items.length; i++) {
          const prevMs = Number(items[i - 1].created_at || 0);
          const curMs = Number(items[i].created_at || 0);
          if (prevMs - curMs < 24 * 60 * 60_000) alertCountThisOutage += 1;
          else break;
        }
      }
    }
  } catch (_) {}

  const stageIdx = Math.min(alertCountThisOutage, BACKOFF_STAGES_MIN.length - 1);
  const requiredGapMin = BACKOFF_STAGES_MIN[stageIdx];
  const sinceLastMin = lastAuditMs > 0 ? (Date.now() - lastAuditMs) / 60_000 : Infinity;

  if (sinceLastMin < requiredGapMin) {
    return ok({
      status: 'alert_skipped_backoff',
      scenario,
      since_last_min: Math.round(sinceLastMin),
      required_gap_min: requiredGapMin,
      stage: stageIdx,
      alert_count_this_outage: alertCountThisOutage,
    });
  }

  // CRITICAL CHANGE: write the audit row BEFORE sending SMS. If the
  // function times out mid-SMS-send (Telnyx occasionally slow), the
  // audit already landed and the NEXT run will dedup correctly.
  // Previous bug: audit was after SMS → slow SMS → function timeout →
  // no audit → next run also fires → SMS storm.
  try {
    await fetch(`${XANO_BASE}/record_event_log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'colony_watchdog_alerted',
        metadata_json: JSON.stringify({
          scenario, ...details,
          alerted_at_ms: Date.now(),
          stage: stageIdx,
          alert_count_this_outage: alertCountThisOutage + 1,
        }),
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (_) {}

  // Compose + send SMS (with explicit context about back-off cadence
  // so Teddy isn't surprised by silence)
  const nextStageMin = BACKOFF_STAGES_MIN[Math.min(stageIdx + 1, BACKOFF_STAGES_MIN.length - 1)];
  const body = `[ant] COLONY ALERT — ${details.reason}. Mac Mini may need a kick: launchctl kickstart -k gui/$UID com.tnappliance.colony-loop. Next alert in ${nextStageMin}min if still down.`;
  let smsOk = false;
  try {
    const r = await fetch(`${XANO_BASE}/send_sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: OWNER_PHONE, message: body, context: { call_site: 'colony_watchdog', scenario, stage: stageIdx } }),
      signal: AbortSignal.timeout(7000),
    });
    smsOk = r.ok;
  } catch (_) {}

  return ok({
    status: 'alerted',
    scenario,
    stage: stageIdx,
    alert_count_this_outage: alertCountThisOutage + 1,
    next_alert_min: nextStageMin,
    sms_ok: smsOk,
    ...details,
  });
}

function ok(body) {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
