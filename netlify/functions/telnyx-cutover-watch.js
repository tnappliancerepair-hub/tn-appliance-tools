// telnyx-cutover-watch — SELF-RUNNING oversight of the Telnyx Ann cutover. Replaces
// the manual "watch the log + confirm the payload + flip the flag" process with a
// durable Netlify cron (survives any session). Three jobs, all hands-off:
//
//   1. AUTO-GRADUATE the dropped-call rescue. The rescue in telnyx-call-webhook stays
//      shadow until we know Telnyx's real payload parses. This confirms that FROM REAL
//      DATA: once >=RESCUE_MIN telnyx_call_event rows have landed AND at least one
//      carried a parseable caller number (proving the field-probing works), it flips
//      the vault flag TELNYX_CALL_RESCUE_LIVE=true via setSecret — no human confirms it.
//   2. WIRING REMINDER. If real calls are flowing but the safety-net webhook has logged
//      ZERO events for >24h, the Insights/call webhook still isn't wired → remind once/day.
//   3. HEALTH. Only a REAL problem pings the owner (precall errors spiking; deduped).
//      Drop-CLUSTER detection is owned by phone-drop-watch (already Telnyx-aware) — not
//      duplicated here.
//
// Reads the Xano event_log (the durable record every piece writes; no auth needed).
//   GET ?dry=1  -> assess + return JSON, change/send nothing (safe to poke)
//   (scheduled every 20 min)
'use strict';
const { getSecretPreferVault, setSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';
const WEBHOOK_URL = 'https://tnapplianceexchange.net/.netlify/functions/telnyx-call-webhook';
const RESCUE_MIN = Number(process.env.TELNYX_RESCUE_MIN || 3);   // real events needed before graduating
// Test/placeholder ANIs that aren't real callers (health-pings, directory number).
const NOT_REAL = new Set(['6155551212', '0000000000', '']);

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
function last10(p) { return String(p || '').replace(/\D/g, '').slice(-10); }
function bizHoursCT() {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const wd = (p.find((x) => x.type === 'weekday') || {}).value || '';
  const h = parseInt((p.find((x) => x.type === 'hour') || {}).value || '0', 10);
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(wd) && h >= 8 && h < 18;
}
async function rows(action, days, limit) {
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=${encodeURIComponent(action)}&days_back=${days || 1}&limit=${limit || 50}`, { signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => null);
    const items = (d && (d.items || d)) || [];
    return (Array.isArray(items) ? items : []).map((x) => { let m = x.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return { at: Number((m && m.at_ms) || 0) || Date.parse(x.created_at) || 0, m: m || {} }; });
  } catch (_) { return []; }
}
const within = (arr, ms) => { const c = Date.now() - ms; return arr.filter((x) => x.at >= c); };

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const dry = ((event && event.queryStringParameters) || {}).dry === '1';
  const actions = [];

  const [precall, callEvents, precallErr, gradMark, wireMark, errMark, quietMark] = await Promise.all([
    rows('telnyx_precall_hit', 1, 120),
    rows('telnyx_call_event', 2, 100),
    rows('telnyx_precall_error', 1, 50),
    rows('telnyx_rescue_graduated', 7, 1),
    rows('telnyx_webhook_reminder', 2, 1),
    rows('telnyx_precall_error_alert', 1, 1),
    rows('telnyx_line_quiet_alert', 1, 1),
  ]);

  const realCalls24h = precall.filter((x) => !NOT_REAL.has(last10(x.m.from_resolved || x.m.from || '')));
  const callEvents24h = within(callEvents, 24 * 3600 * 1000);
  const parseableEvent = callEvents.find((x) => x.m && x.m.from && last10(x.m.from).length >= 10);
  const alreadyLive = (await getSecretPreferVault('TELNYX_CALL_RESCUE_LIVE')) === 'true';

  // ── 1. AUTO-GRADUATE the rescue ──────────────────────────────────────────────
  let rescue_state = alreadyLive ? 'already_live' : 'shadow';
  if (!alreadyLive && callEvents.length >= RESCUE_MIN && parseableEvent) {
    if (!dry) {
      const ok = await setSecret('TELNYX_CALL_RESCUE_LIVE', 'true');
      await crud.logEvent('telnyx_rescue_graduated', { events_seen: callEvents.length, sample_from: parseableEvent.m.from, set_ok: ok, at_ms: Date.now() }).catch(() => null);
      if (ok) await sendSms(OWNER, `🐜 New Ann's dropped-call auto-callback is now LIVE — auto-verified against ${callEvents.length} real calls on the Telnyx line. A caller who drops before connecting now gets an automatic callback. Nothing for you to do.`, 'owner', 'telnyx_rescue_live').catch(() => null);
      rescue_state = ok ? 'graduated_now' : 'graduate_failed';
    } else { rescue_state = 'would_graduate'; }
    actions.push(rescue_state);
  }

  // ── 2. WIRING REMINDER (once/day) — real calls flowing but no webhook events ──
  if (realCalls24h.length >= 3 && callEvents24h.length === 0) {
    const remindedRecently = wireMark.length && (Date.now() - wireMark[0].at) < 22 * 3600 * 1000;
    if (!remindedRecently && !dry) {
      await sendSms(OWNER, `🐜 Heads up: the new Ann line is taking calls, but the drop safety-net webhook still isn't wired. It's a 2-min portal step — Telnyx → AI Assistant → Insights → webhook URL: ${WEBHOOK_URL}. That's the last piece; everything else is running.`, 'owner', 'telnyx_webhook_reminder').catch(() => null);
      await crud.logEvent('telnyx_webhook_reminder', { real_calls_24h: realCalls24h.length, at_ms: Date.now() }).catch(() => null);
      actions.push('wiring_reminder_sent');
    } else { actions.push(dry ? 'would_remind_wiring' : 'wiring_reminder_held'); }
  }

  // ── 3. HEALTH — precall errors spiking (real problem, deduped 60 min) ─────────
  const errs1h = within(precallErr, 3600 * 1000).length;
  if (errs1h >= 5) {
    const alertedRecently = errMark.length && (Date.now() - errMark[0].at) < 60 * 60 * 1000;
    if (!alertedRecently && !dry) {
      await sendSms(OWNER, `⚠️ New Ann (Telnyx) pre-call brain threw ${errs1h} errors in the last hour — callers may be getting the generic fallback greeting instead of greet-by-name. Worth a look.`, 'owner', 'telnyx_precall_error_alert').catch(() => null);
      await crud.logEvent('telnyx_precall_error_alert', { errs_1h: errs1h, at_ms: Date.now() }).catch(() => null);
      actions.push('precall_error_alert_sent');
    } else { actions.push(dry ? 'would_alert_errors' : 'error_alert_held'); }
  }

  // ── 4. LINE WENT QUIET — the phone-DOWN early warning (July 3rd: a silent line
  //    took 3 days to notice). Works even without the call-event webhook: during
  //    business hours, if the main line normally flows calls (>=5 real in the read
  //    window) but has taken ZERO in ~80 min, flag it as possibly stopped answering.
  //    Deduped 2h to avoid nagging on a naturally slow stretch.
  const realRecent = within(realCalls24h, 80 * 60 * 1000).length;
  if (bizHoursCT() && realRecent === 0 && realCalls24h.length >= 5) {
    const alertedRecently = quietMark.length && (Date.now() - quietMark[0].at) < 2 * 3600 * 1000;
    if (!alertedRecently && !dry) {
      await sendSms(OWNER, `⚠️ New Ann's main line (615-280-2949) has taken 0 calls in ~80 min during business hours — it normally flows. The line may have stopped answering. Check it; to roll back, point 280-2949's connection back to Vapi in the Telnyx portal.`, 'owner', 'telnyx_line_quiet_alert').catch(() => null);
      await crud.logEvent('telnyx_line_quiet_alert', { real_24h: realCalls24h.length, at_ms: Date.now() }).catch(() => null);
      actions.push('line_quiet_alert_sent');
    } else { actions.push(dry ? 'would_alert_quiet' : 'quiet_alert_held'); }
  }

  return json(200, {
    ok: true, dry, biz_hours: bizHoursCT(),
    real_calls_24h: realCalls24h.length, real_recent_80m: realRecent, call_events_2d: callEvents.length, call_events_24h: callEvents24h.length,
    precall_errors_1h: errs1h, rescue_state, webhook_wired: callEvents.length > 0, actions,
  });
};
