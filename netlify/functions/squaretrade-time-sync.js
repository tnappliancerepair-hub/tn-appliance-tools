// squaretrade-time-sync — GET THE CUSTOMER'S AGREED TIME RIGHT, NO EXCEPTIONS.
//
// SquareTrade/ServicePower books the customer into a window they already agreed to. Our
// intake parsing has mangled that time for years (defaulting to 8am), so customers get
// blindsided by the wrong arrival time. This syncs the agreed window straight from the
// AUTHORITY — the ServicePower API (getCallInfo → ScheduleTimePeriod, e.g. "8-10","13-16")
// — onto every matching job, so the promised window is captured verbatim from the source
// and can never be lost or faked. It also FLAGS any job whose scheduled time doesn't match
// the agreed window, so nothing slips through. (Teddy 2026-07-16: "we must get the times
// available right, no exceptions.")
//
//   scheduled (netlify.toml) · manual: ?secret=VAPI_ADMIN_SECRET[&dryrun=1][&days=21]
'use strict';

const sp = require('./_lib/servicepower');
const { parseScheduleWindow } = require('./_lib/parsers/servicepower');
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const { officeTaskAlert } = require('./_lib/office-alert');
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function fmt(d) { const p = (n) => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
function ctHourOf(ms) { try { return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date(Number(ms))), 10); } catch (_) { return -1; } }
function digits(s) { return String(s || '').replace(/\D/g, ''); }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled) {
    const guard = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== guard) return j(403, { ok: false, error: 'forbidden' });
  }
  const dry = q.dryrun === '1';
  const applyTime = q.apply_time === '1' && !dry;   // also CORRECT scheduled_start to the agreed window
  const days = Math.min(45, parseInt(q.days || '21', 10) || 21);
  const DONE = new Set(['in_progress', 'completed', 'canceled', 'cancelled', 'no_fix_possible']);

  // 1) Pull the source of truth — every ServicePower call + its agreed window. Chunk the
  //    range (past few days .. upcoming weeks) in 2-day windows to dodge the SP007 limit.
  const byCall = new Map();
  const now = Date.now();
  for (let off = -4; off < days; off += 2) {
    const from = new Date(now + off * 86400000);
    const to = new Date(now + Math.min(days, off + 2) * 86400000);
    try { const r = await sp.getCallInfo({ fromDateTime: fmt(from), toDateTime: fmt(to) }); for (const c of (r.calls || [])) if (c.call_number) byCall.set(digits(c.call_number), c); } catch (_) {}
  }

  // 2) Our SquareTrade jobs.
  let jobs = [];
  try { const r = await fetch(`${XANO}/get_office_kanban`, { signal: AbortSignal.timeout(20000) }); const d = await r.json(); for (const k in d) { if (Array.isArray(d[k])) { jobs = d[k]; break; } } } catch (_) {}
  const st = jobs.filter((x) => /square/i.test(String(x.warranty_company || '')));

  const out = { matched: 0, written: 0, time_corrected: 0, mismatches: [], unmatched: 0, no_window: 0, api_calls: byCall.size };
  for (const job of st) {
    const call = byCall.get(digits(job.claim_number)) || byCall.get(digits(job.dispatch_source_id));
    if (!call) { out.unmatched++; continue; }
    const win = parseScheduleWindow(call.schedule_time || '');
    if (!win.window || !win.startHHMM) { out.no_window++; continue; }
    out.matched++;
    // The agreed window, verbatim from the source, in a clean label.
    const agreedNote = `AVAIL: Customer agreed to ${win.window} (SquareTrade)`;
    const curPref = String(job.customer_preference_text || '').trim();
    const curWin = String(job.service_eta_window || '').trim();
    const needWrite = curWin.toLowerCase() !== win.window.toLowerCase() || !/agreed to/i.test(curPref);
    // Does our scheduled time match the agreed window start? (blindside check)
    const agreedHour = parseInt(win.startHHMM.slice(0, 2), 10);
    const ourHour = Number(job.scheduled_start) > 0 ? ctHourOf(job.scheduled_start) : -1;
    const statusDone = DONE.has(String(job.scheduling_status || '').toLowerCase()) || DONE.has(String(job.current_status || '').toLowerCase());
    const timeOff = ourHour >= 0 && ourHour !== agreedHour;
    if (timeOff) {
      out.mismatches.push({ job_id: job.id, who: `${job.customer_first || ''} ${job.customer_last || ''}`.trim(), agreed: win.window, we_have: `${ourHour}:00`, claim: job.claim_number, fixable: !statusDone });
    }
    // The write: always capture the agreed window (safe). Optionally CORRECT the scheduled
    // start to the agreed window's start hour — same day, just shift the hour (DST-safe) —
    // but ONLY for jobs not yet started/finished, so a live/done job is never moved.
    const patch = {};
    if (needWrite) { patch.service_eta_window = win.window; patch.customer_preference_text = agreedNote; }
    let willCorrect = false;
    if (applyTime && timeOff && !statusDone && Number(job.scheduled_start) > 0) {
      patch.scheduled_start = Number(job.scheduled_start) + (agreedHour - ourHour) * 3600000;
      willCorrect = true;
    }
    if (Object.keys(patch).length) {
      if (!dry) { try { await crud.update(crud.TABLES.jobs, job.id, patch); if (needWrite) out.written++; if (willCorrect) out.time_corrected++; } catch (_) {} }
      else { if (needWrite) out.written++; if (willCorrect) out.time_corrected++; }
    }
  }

  // 3) No exceptions: if any job's scheduled time disagrees with the promised window, tell
  //    the SCHEDULERS (Danielle + Sofia) so it's fixed before the customer is blindsided.
  if (!dry && out.mismatches.length) {
    const lines = out.mismatches.slice(0, 8).map((m) => `#${m.job_id} ${m.who}: promised ${m.agreed}, we have ${m.we_have}`).join('\n');
    const msg = `⚠️ Ant: ${out.mismatches.length} SquareTrade job(s) scheduled OUTSIDE the customer's agreed window — fix before they're blindsided:\n${lines}`;
    try { await officeTaskAlert(msg, 'squaretrade_time_mismatch'); } catch (_) {}   // → Danielle+Sofia, biz hours
  }

  return j(200, { ok: true, dry, ...out, mismatches: out.mismatches.slice(0, 40) });
};
