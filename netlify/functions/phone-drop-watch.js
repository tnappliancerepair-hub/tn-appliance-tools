// phone-drop-watch — near-real-time PHONE-DOWN detector. The 7/3 outage (a
// cluster of calls that never connected — carrier/transport fault) took THREE
// DAYS to notice by hand. This turns that into a few-minute alert.
//
// Every ~5 min it reads the recent inbound calls (via vapi-admin daycalls),
// counts DISTINCT callers whose call NEVER CONNECTED (0-2s, transport/carrier/
// pipeline fault) inside a short window, and if that clusters above a threshold
// it pages the owner + office ONCE per incident. When the line demonstrably
// recovers (a real inbound conversation happens after an open incident) it sends
// a "phone recovered" ping and closes the incident.
//
// Conservative by design (this session's hard lesson: never become alert spam):
//   • Only NEVER-CONNECTED drops count — NOT normal silence-timeouts / hang-ups.
//   • DISTINCT callers, so one flaky caller can't trip it.
//   • One alert per incident; re-ping at most every 30 min while still down.
//   • Kill switch: env PHONE_DROP_WATCH=off silences all sends instantly.
//
//   GET  ?dry=1     -> compute + return JSON, send nothing (safe to poke)
//   GET  ?secret=<admin>  -> compute + may send
//   (scheduled every 5 min: computes + alerts/recovers automatically)
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

const SITE = 'https://tnapplianceexchange.net/.netlify/functions';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const OWNER = '+16154855795';           // Teddy — infra owner
const DANIELLE = '+16154850713';        // office, so a human can field the line

const WINDOW_MIN = Number(process.env.PHONE_DROP_WINDOW_MIN || 20);   // look-back window
const THRESHOLD = Number(process.env.PHONE_DROP_THRESHOLD || 3);      // distinct never-connected callers
const REPING_MIN = Number(process.env.PHONE_DROP_REPING_MIN || 30);   // re-ping cadence while still down

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
function last10(p) { return String(p || '').replace(/\D/g, '').slice(-10); }
// A call that NEVER CONNECTED — carrier / transport / pipeline fault, or a
// 0-2s call that failed/errored with no conversation. This is the outage
// fingerprint. Deliberately excludes plain silence-timeouts + normal hang-ups.
function neverConnected(c) {
  const ended = String(c.ended || '').toLowerCase();
  const dur = c.dur_s == null ? null : Number(c.dur_s);
  if (/transport-never-connected|provider-?fault|providerfault|\btransport\b|did-not-receive-customer-audio|pipeline-error|no-microphone|no-media|failed-to-connect|vapifault/.test(ended)) return true;
  if ((dur != null && dur <= 2) && /failed|error|no-?answer|busy/.test(ended)) return true;
  return false;
}

// Most-recent event_log row for an action, within days_back. Bounded + safe.
async function lastEvent(action) {
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=${encodeURIComponent(action)}&days_back=1&limit=1`, { signal: AbortSignal.timeout(6000) });
    const d = await r.json().catch(() => null);
    const items = (d && (d.items || d)) || [];
    const row = Array.isArray(items) && items.length ? items[0] : null;
    if (!row) return null;
    let m = row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    const at = Number((m && m.at_ms) || 0) || Date.parse(row.created_at) || 0;
    return { at, meta: m || {} };
  } catch (_) { return null; }
}

async function analyze(admin) {
  // Pull the last 2h of calls (cheap) and window in-code to the last WINDOW_MIN.
  const r = await fetch(`${SITE}/vapi-admin?secret=${encodeURIComponent(admin)}&action=daycalls&hours=2`, { signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  const all = ((d && d.calls) || []).filter((c) => c.dir !== 'outbound');
  const cutoff = Date.now() - WINDOW_MIN * 60 * 1000;
  const win = all.filter((c) => { const t = Date.parse(c.at || 0); return t && t >= cutoff; });
  const droppedCallers = new Set();
  for (const c of win) { if (neverConnected(c)) droppedCallers.add(last10(c.from) || c.id); }
  // A demonstrably-healthy call = a real inbound conversation happened in the window.
  const healthy = win.some((c) => Number(c.dur_s || 0) > 25 && !neverConnected(c));
  return {
    ok: d && d.ok !== false,
    window_min: WINDOW_MIN,
    window_calls: win.length,
    dropped_distinct: droppedCallers.size,
    healthy_call_seen: healthy,
    alarm: droppedCallers.size >= THRESHOLD,
    sample: win.filter(neverConnected).slice(0, 6).map((c) => ({ from: c.from, dur_s: c.dur_s, ended: c.ended })),
  };
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const dry = q.dry === '1';
  const sendsOn = String(process.env.PHONE_DROP_WATCH || 'on').toLowerCase() !== 'off';
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;

  let a;
  try { a = await analyze(admin); }
  catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }

  // Incident state: open if the last alert is newer than the last recovery.
  const [alert, recovered] = await Promise.all([lastEvent('phone_drop_alert'), lastEvent('phone_drop_recovered')]);
  const incidentOpen = !!alert && (!recovered || alert.at > recovered.at);
  const sinceLastAlertMin = alert ? (Date.now() - alert.at) / 60000 : Infinity;

  const actions = [];

  // ── ALARM: a cluster of never-connected calls ──
  if (a.alarm) {
    const shouldSend = !incidentOpen || sinceLastAlertMin >= REPING_MIN;
    if (shouldSend && !dry) {
      const body = `🚨 PHONE ALERT — ${a.dropped_distinct} callers in the last ${a.window_min} min got a call that NEVER CONNECTED (carrier/transport drop). The line may be down. Test it now: call 615-588-9500. ${incidentOpen ? '(still down)' : ''}`.trim();
      if (sendsOn) {
        await Promise.allSettled([
          sendSms(OWNER, body, 'owner', 'phone_drop_alert'),
          sendSms(DANIELLE, body, 'warranty_handler', 'phone_drop_alert'),
        ]);
      }
      await crud.logEvent('phone_drop_alert', { dropped_distinct: a.dropped_distinct, window_min: a.window_min, sample: a.sample, reping: incidentOpen, sends_on: sendsOn, at_ms: Date.now() }).catch(() => null);
      actions.push(incidentOpen ? 'reping_alert' : 'opened_incident');
    } else {
      actions.push(dry ? 'dry_would_alert' : 'alarm_held_open_incident');
    }
  }

  // ── RECOVERY: an open incident + the line is demonstrably back ──
  else if (incidentOpen && a.healthy_call_seen) {
    if (!dry) {
      const body = `✅ Phone recovered — a call is connecting normally again. (Was flagged as possibly down for ~${Math.round(sinceLastAlertMin)} min.)`;
      if (sendsOn) {
        await Promise.allSettled([
          sendSms(OWNER, body, 'owner', 'phone_drop_recovered'),
          sendSms(DANIELLE, body, 'warranty_handler', 'phone_drop_recovered'),
        ]);
      }
      await crud.logEvent('phone_drop_recovered', { down_minutes: Math.round(sinceLastAlertMin), at_ms: Date.now() }).catch(() => null);
      actions.push('recovered');
    } else {
      actions.push('dry_would_recover');
    }
  }

  return json(200, { ok: true, analysis: a, incident_open: incidentOpen, since_last_alert_min: Number.isFinite(sinceLastAlertMin) ? Math.round(sinceLastAlertMin) : null, sends_on: sendsOn, dry, actions });
};
