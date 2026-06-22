// schedule-sanity — scans this week's scheduled jobs and flags the ones whose
// TIME or TECH looks wrong, so Danielle can fix them BEFORE the time-based
// automations (reminders, running-late, morning ETA texts) act on bad data.
// Born from the running-late false-alarms (2026-06-22): "trying to make sure the
// schedule is right — Andre's times were wrong." Read-only.
//
//   GET /schedule-sanity?key=tn-schedule-2026  ->  { ok, today_ct, buckets:{...}, total }

'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const KEY = 'tn-schedule-2026';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function ctParts(ms) {
  // {hour, min, dow, ymd, label} in America/Chicago
  if (!ms) return null;
  const d = new Date(Number(ms));
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const hh = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(d)) % 24;
  const mm = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', minute: 'numeric' }).format(d));
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return { hour: hh, min: mm, ymd, label: f.format(d) };
}
function todayCT() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
const TERMINAL = ['completed', 'complete', 'canceled', 'cancelled', 'done', 'no_fix_possible'];

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if ((q.key || '') !== KEY) return { statusCode: 401, headers: CORS, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };

  let wk;
  try { wk = await (await fetch(`${XANO}/get_office_calendar_week`)).json(); }
  catch (e) { return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'calendar fetch failed' }) }; }

  const jobs = (wk && wk.jobs) || [];
  const techs = {}; ((wk && wk.technicians) || []).forEach((t) => { techs[t.id] = ((t.first_name || '') + ' ' + (t.last_name || '')).trim(); });
  const today = todayCT();
  const now = Date.now();

  // count jobs per (tech, exact start) to detect pileups / double-books
  const slot = {};
  for (const j of jobs) {
    const tid = j.technician_id || 0;
    const st = j.scheduled_start || 0;
    if (!st) continue;
    const k = tid + '@' + st;
    (slot[k] = slot[k] || []).push(j);
  }

  const buckets = { no_tech: [], placeholder: [], double_book: [], past_open: [], no_time: [] };

  function shape(j, extra) {
    const cp = ctParts(j.scheduled_start);
    return Object.assign({
      job_id: j.id,
      customer: ((j.customer_first_name || '') + ' ' + (j.customer_last_name || '')).trim() || '(no name)',
      phone: j.customer_phone || '',
      appliance: [j.brand, j.appliance_type].filter(Boolean).join(' ') || 'appliance',
      city: j.service_city || '',
      tech_id: j.technician_id || 0,
      tech: techs[j.technician_id] || (j.technician_id ? ('Tech #' + j.technician_id) : 'UNASSIGNED'),
      when: cp ? cp.label : 'no time',
      status: j.current_status || j.scheduling_status || '',
      vendor: j.warranty_company || '',
    }, extra || {});
  }

  const seenDouble = new Set();
  for (const j of jobs) {
    const status = String(j.current_status || j.scheduling_status || '').toLowerCase();
    if (TERMINAL.includes(status)) continue;
    const st = j.scheduled_start || 0;
    const cp = st ? ctParts(st) : null;

    // 1) scheduled but no time at all
    if (!st) { buckets.no_time.push(shape(j)); continue; }

    // 2) unassigned but sitting on the calendar with a time
    if (!j.technician_id) { buckets.no_tech.push(shape(j)); continue; }

    // 3) past but still open (slipped — today or earlier, not done)
    if (cp && cp.ymd < today) { buckets.past_open.push(shape(j, { overdue_days: Math.max(1, Math.round((now - st) / 86400000)) })); continue; }
    if (cp && cp.ymd === today && st < now) { buckets.past_open.push(shape(j, { overdue_days: 0 })); continue; }

    // 4) double-booked: same tech, same exact start, 2+ jobs
    const k = (j.technician_id || 0) + '@' + st;
    if (slot[k] && slot[k].length > 1) {
      if (!seenDouble.has(k)) { seenDouble.add(k); buckets.double_book.push({ slot: cp ? cp.label : '', tech: techs[j.technician_id] || ('Tech #' + j.technician_id), count: slot[k].length, jobs: slot[k].map((x) => shape(x)) }); }
      // also fall through to placeholder check below? no — one flag per job is enough
      continue;
    }

    // 5) placeholder default time (8:00 or 9:00 sharp = the seeded default, not a real window)
    if (cp && (cp.min === 0) && (cp.hour === 8 || cp.hour === 9)) { buckets.placeholder.push(shape(j)); continue; }
  }

  const total = buckets.no_tech.length + buckets.placeholder.length + buckets.double_book.length + buckets.past_open.length + buckets.no_time.length;
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, today_ct: today, week: wk.week_start_ct, total, counts: { no_tech: buckets.no_tech.length, placeholder: buckets.placeholder.length, double_book: buckets.double_book.length, past_open: buckets.past_open.length, no_time: buckets.no_time.length }, buckets }) };
};
