// overtexting-watch — the tripwire against the SquareTrade over-texting incident.
// Scans EVERY customer text (sms_guard_sent from all senders + intake_light_sent from
// the collector) over the last N days, grouped by PHONE, and flags anyone who got too
// many. Alerts Teddy, and AUTO-PAUSES the intake outreach if it's bad — so an
// over-texting bug can never quietly run for a week again. (Teddy 2026-07-13.)
//
//   GET                     -> report: per-phone counts, who's over the line
//   GET ?alert=1            -> report + SMS Teddy if anyone's over (the scheduled run)
//   GET ?pause=1&secret=    -> pause ALL intake outreach now
//   GET ?resume=1&secret=   -> resume it
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = process.env.OWNER_ALERT_PHONE || '+16154855795';   // Teddy (internal → bypasses the customer gate)

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }
const norm = (p) => String(p == null ? '' : p).replace(/\D/g, '').slice(-10);
const meta = (r) => { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; };
async function rows(action, n) { try { return await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, n); } catch (_) { return []; } }
async function jpost(url, body) { try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(9000) }); return r.json().catch(() => ({})); } catch (_) { return {}; } }

// A phone that got MORE than SAFE texts in the window is "over." HARD = auto-pause.
const SAFE = Number(process.env.OVERTEXT_SAFE) || 3;
const HARD = Number(process.env.OVERTEXT_HARD) || 5;
const WINDOW_DAYS = Number(process.env.OVERTEXT_WINDOW_DAYS) || 7;

// Pause state = latest 'intake_outreach_paused' newer than latest 'intake_outreach_resumed'.
async function pauseState() {
  const [p, r] = await Promise.all([rows('intake_outreach_paused', 1), rows('intake_outreach_resumed', 1)]);
  const ts = (arr) => arr[0] ? (Number(meta(arr[0]).at_ms) || new Date(arr[0].created_at).getTime() || 0) : 0;
  return ts(p) > ts(r);
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = String(q.secret || '') === (process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5');
  // Netlify scheduled runs POST a { next_run } body and can't pass ?alert=1 — treat
  // them as alert mode (scan + alert + auto-pause). A plain manual GET is view-only.
  const scheduled = (() => { try { return !!JSON.parse((event && event.body) || '{}').next_run; } catch (_) { return false; } })();
  const alertMode = q.alert === '1' || scheduled;

  if (q.pause === '1') { if (!admin) return j(403, { ok: false, error: 'forbidden' }); await crud.logEvent('intake_outreach_paused', { by: 'manual', at_ms: Date.now() }); return j(200, { ok: true, paused: true }); }
  if (q.resume === '1') { if (!admin) return j(403, { ok: false, error: 'forbidden' }); await crud.logEvent('intake_outreach_resumed', { by: 'manual', at_ms: Date.now() }); return j(200, { ok: true, paused: false }); }

  const since = Date.now() - WINDOW_DAYS * 86400000;
  const [guard, intake] = await Promise.all([rows('sms_guard_sent', 2000), rows('intake_light_sent', 2000)]);
  const byPhone = {};
  const add = (ph, ts) => { const p = norm(ph); if (p.length < 10 || !ts || ts < since) return; const c = byPhone[p] = byPhone[p] || { count: 0, last: 0 }; c.count++; if (ts > c.last) c.last = ts; };
  for (const r of guard) { const m = meta(r); add(m.phone, Number(m.at_ms) || new Date(r.created_at).getTime() || 0); }
  for (const r of intake) { const m = meta(r); add(m.phone_e164 || m.phone, Number(m.at_ms) || new Date(r.created_at).getTime() || 0); }

  const over = Object.entries(byPhone).filter(([, c]) => c.count > SAFE).map(([p, c]) => ({ phone: '•••' + p.slice(-4), count: c.count })).sort((a, b) => b.count - a.count);
  const worst = over.length ? over[0].count : 0;
  let paused = await pauseState();

  // AUTO-PAUSE on a real problem: any phone at/over HARD, or a cluster (5+) over the line.
  let autoPaused = false;
  if (alertMode && !paused && (worst >= HARD || over.length >= 5)) {
    await crud.logEvent('intake_outreach_paused', { by: 'overtexting-watch', worst, over_count: over.length, at_ms: Date.now() });
    autoPaused = true; paused = true;
  }
  // Alert Teddy whenever anyone's over (scheduled run only).
  if (alertMode && over.length) {
    const msg = `⚠️ Over-texting check: ${over.length} customer(s) got more than ${SAFE} texts in ${WINDOW_DAYS}d (worst ${worst}).`
      + (autoPaused ? ' 🛑 Intake outreach AUTO-PAUSED — reply once fixed.' : '')
      + ' See /.netlify/functions/overtexting-watch';
    await jpost(`${XANO}/send_sms`, { to: OWNER, message: msg, context_tag: 'overtext_alert', force_send: true });
  }

  return j(200, { ok: true, window_days: WINDOW_DAYS, safe_threshold: SAFE, hard_threshold: HARD, phones_texted: Object.keys(byPhone).length, over_count: over.length, worst, paused, auto_paused: autoPaused, over });
};
