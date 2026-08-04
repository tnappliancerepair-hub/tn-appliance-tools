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
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'web_funnel' }, { id: 'desc' }, 500); } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }

  const cutoff = Date.now() - days * 86400000;
  // The full drop-off ladder, in order.
  const ORDER = ['open', 'started', 'problem', 'video', 'model', 'contact', 'reached_pay', 'paid'];
  const LABEL = { open: 'Opened the page', started: 'Picked an appliance', problem: 'Described the problem', video: 'Reached the video step', model: 'Reached the model-photo step', contact: 'Reached the contact step', reached_pay: 'Saw the pay screen', paid: 'Paid' };
  const newSets = () => { const o = {}; for (const s of ORDER) o[s] = new Set(); return o; };
  // per day -> per step -> Set of unique keys (conv_id, or row id when conv_id blank)
  const byDay = {};
  const all = newSets();
  for (const r of rows) {
    const m = meta(r);
    const step = m.step;
    if (!step || ORDER.indexOf(step) < 0) continue;
    const ms = Number(m.at_ms) || Date.parse(r.created_at || '') || 0;
    if (!ms || ms < cutoff) continue;
    const day = ctDay(ms);
    const key = (m.conv_id && String(m.conv_id)) || ('row' + r.id);
    byDay[day] = byDay[day] || newSets();
    byDay[day][step].add(key);
    all[step].add(key);
  }

  const pct = (n, base) => base > 0 ? Math.round((n / base) * 1000) / 10 : null;
  const out = Object.keys(byDay).sort().reverse().map((day) => {
    const d = byDay[day];
    const open = d.open.size, started = d.started.size, reached = d.reached_pay.size, paid = d.paid.size;
    return { day, opened: open, started, video: d.video.size, model: d.model.size, contact: d.contact.size, reached_pay: reached, paid,
      close_rate_pct: pct(paid, reached), started_to_paid_pct: pct(paid, started) };
  });

  // The drop-off ladder across the whole window: count at each step, % of everyone
  // who opened, and % who survived the PREVIOUS step (so the biggest leak is obvious).
  const openN = all.open.size;
  let prev = null;
  const ladder = ORDER.map((s) => {
    const n = all[s].size;
    const row = { step: s, label: LABEL[s], count: n, pct_of_opened: pct(n, openN), kept_from_prev: prev == null ? null : pct(n, prev), dropped_from_prev: prev == null ? null : (prev - n) };
    prev = n; return row;
  });
  // biggest single drop-off (where we lose the most people between two steps)
  let biggest = null;
  for (let i = 1; i < ladder.length; i++) { const dr = ladder[i].dropped_from_prev || 0; if (!biggest || dr > biggest.dropped) biggest = { from: ladder[i - 1].label, to: ladder[i].label, dropped: dr, kept_pct: ladder[i].kept_from_prev }; }

  const tReached = all.reached_pay.size, tPaid = all.paid.size, tStarted = all.started.size;
  const totals = {
    opened: openN, started: tStarted, reached_pay: tReached, paid: tPaid,
    close_rate_pct: pct(tPaid, tReached), started_to_paid_pct: pct(tPaid, tStarted),
  };
  return j(200, { ok: true, days, totals, biggest_dropoff: biggest, ladder, by_day: out });
};
