// pay-funnel — the $50 Quick Check conversion funnel, by day. Answers Teddy's
// question: "how do people go about the $50?" Pulls the web_funnel events
// (open → started → reached_pay → paid, all keyed by conv_id) and reports, per CT
// day, unique counts at each step + the rates that matter:
//   reached_pay → paid  = of the people who hit the pay button, how many paid
//   started     → paid  = of the people who began, how many paid
// Gated: ?secret=<admin> OR ?password=<office>. ?days=14 (default).
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function ctDay(ms) { const p = {}; for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms))) p[x.type] = x.value; return `${p.year}-${p.month}-${p.day}`; }
async function officeOk(pw) { if (!pw) return false; try { const r = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) }); const d = await r.json(); return !!(d && d.success === true); } catch (_) { return false; } }

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const ok = q.secret === admin || (await officeOk(q.password));
  if (!ok) return j(401, { ok: false, error: 'unauthorized' });

  const days = Math.max(1, Math.min(60, parseInt(q.days, 10) || 14));
  let rows = [];
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'web_funnel' }, { id: 'desc' }, 1000); } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }

  const cutoff = Date.now() - days * 86400000;
  // per day -> per step -> Set of unique keys (conv_id, or row id when conv_id blank)
  const byDay = {};
  for (const r of rows) {
    const m = meta(r);
    const step = m.step;
    if (!step) continue;
    const ms = Number(m.at_ms) || Date.parse(r.created_at || '') || 0;
    if (!ms || ms < cutoff) continue;
    const day = ctDay(ms);
    const key = (m.conv_id && String(m.conv_id)) || ('row' + r.id);
    byDay[day] = byDay[day] || { open: new Set(), started: new Set(), reached_pay: new Set(), paid: new Set() };
    if (byDay[day][step]) byDay[day][step].add(key);
  }

  const out = Object.keys(byDay).sort().reverse().map((day) => {
    const d = byDay[day];
    const open = d.open.size, started = d.started.size, reached = d.reached_pay.size, paid = d.paid.size;
    const pct = (n, base) => base > 0 ? Math.round((n / base) * 1000) / 10 : null;
    return { day, opened: open, started, reached_pay: reached, paid,
      close_rate_pct: pct(paid, reached),      // of those who hit pay, how many paid
      started_to_paid_pct: pct(paid, started), // of those who began, how many paid
    };
  });

  // totals across the window
  const sum = (k) => out.reduce((a, r) => a + r[k], 0);
  const tReached = sum('reached_pay'), tPaid = sum('paid'), tStarted = sum('started');
  const totals = {
    opened: sum('opened'), started: tStarted, reached_pay: tReached, paid: tPaid,
    close_rate_pct: tReached > 0 ? Math.round((tPaid / tReached) * 1000) / 10 : null,
    started_to_paid_pct: tStarted > 0 ? Math.round((tPaid / tStarted) * 1000) / 10 : null,
  };
  return j(200, { ok: true, days, totals, by_day: out });
};
