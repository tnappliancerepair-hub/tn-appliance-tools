// JOB SAFETY WATCHDOG — the "we can't miss jobs" fail-safe.
//
// Runs every 30 min. Calls job_safety_sweep (recover:true) which:
//   - auto-heals jobs stranded in "broadcasting" back into the schedule queue
//   - reports the actionable backlog + how long since the last intake
// Then SMSes BOTH Teddy + Danielle if anything looks wrong — so a problem
// pages a human instead of silently piling up. Deploys via Netlify (no Mac
// Mini dependency), so the safety net runs even if the colony loop is down.
//
// Alerts on: stuck jobs recovered, intake stalled (no new job in 3h during
// business hours = pollers/Gmail down), or a large scheduling backlog.
// Deduped to one alert per 2h so it informs without spamming.

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TEDDY = '+16154855795';
const DANIELLE = '+16154850713';
const STALL_MIN = 180;      // no new job in 3h (business hours) => intake alarm
const BACKLOG_MAX = 60;     // jobs waiting to schedule before we flag a backlog
const DEDUP_MS = 2 * 3600 * 1000;

async function post(path, body) {
  // Time-box every call so a slow Xano moment can't hang the function (an un-timed
  // fetch that Netlify eventually kills is exactly what surfaced as "fetch failed").
  const r = await fetch(XANO + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(20000),
  });
  return r.json().catch(() => ({}));
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

exports.handler = async () => {
  const startedAt = Date.now();

  // 1. Reconcile + auto-heal stranded jobs. Retry a couple times before paging —
  // a single transient "fetch failed" (momentary Xano blip) is not an emergency and
  // shouldn't text Teddy. Only a sweep that fails on ALL attempts is a real alarm.
  let rep, lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { rep = await post('/job_safety_sweep', { recover: true, stuck_hours: 3 }); lastErr = null; break; }
    catch (e) { lastErr = e; if (attempt < 3) await sleep(attempt * 3000); }   // 3s, 6s backoff
  }
  if (lastErr) {
    // Failed all 3 attempts — that's a genuine "check the system" page.
    try { await post('/send_sms', { to: TEDDY, message: '[ant safety] job_safety_sweep FAILED after 3 tries — check the system. ' + String(lastErr.message || lastErr).slice(0, 120) }); } catch (_) {}
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'sweep_failed' }) };
  }

  const total = Number(rep.total_actionable || 0);
  const recovered = Number(rep.recovered || 0);
  const mins = Number(rep.minutes_since_last_job || 0);

  // CT hour (CDT = UTC-5) for business-hours gating on the intake-stall alarm.
  const ctHour = ((new Date().getUTCHours() - 5) + 24) % 24;
  const businessHours = ctHour >= 7 && ctHour < 21;

  // ONLY text on a genuine emergency: intake has stalled (pollers/Gmail down),
  // which is invisible otherwise. Routine self-healing (recovered>0) and the
  // standing backlog are NOT texted — the office sees the backlog in the UI,
  // and stuck jobs are auto-recovered silently above. No text storms.
  const issues = [];
  if (businessHours && mins > STALL_MIN) issues.push(`no new job intake in ${Math.round(mins / 60)}h — pollers/Gmail may be down`);

  if (!issues.length) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, total, recovered, mins, alerted: false, elapsed_ms: Date.now() - startedAt }) };
  }

  // Dedup — one alert per DEDUP_MS so persistent conditions don't spam.
  let lastAlert = 0;
  try {
    const d = await fetch(`${XANO}/get_event_log_by_action?action=job_safety_alert`).then((r) => r.json());
    lastAlert = (d && d.last_at) || 0;
  } catch (_) {}
  if (lastAlert && (Date.now() - lastAlert < DEDUP_MS)) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, total, recovered, mins, alerted: false, reason: 'deduped' }) };
  }

  const msg = `[ant safety] ${issues.join('; ')}. ${total} job(s) in the schedule queue. Open: tnapplianceexchange.net/needs-scheduled.html`;
  try { await post('/send_sms', { to: TEDDY, message: msg, context_tag: 'job_safety' }); } catch (_) {}
  try { await post('/send_sms', { to: DANIELLE, message: msg, context_tag: 'job_safety' }); } catch (_) {}
  try { await post('/record_event_log', { action: 'job_safety_alert', metadata_json: JSON.stringify({ total, recovered, mins, issues }) }); } catch (_) {}

  return { statusCode: 200, body: JSON.stringify({ ok: true, total, recovered, mins, alerted: true, issues, elapsed_ms: Date.now() - startedAt }) };
};
