// servicepower-jobs — owner-gated. Pulls TN Appliance's live ServicePower dispatches
// via getCallInfo (chunked to dodge the SP007 wide-range limit), dedupes, and returns
// a clean job list + a status summary. The board Teddy's never seen via API.
//   GET ?secret=<admin>&days=21&chunk=4
'use strict';
const sp = require('./_lib/servicepower');
const { getSecret } = require('./_lib/secrets');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function fmt(d) { const p = (n) => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const adminSecret = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== adminSecret) return json(401, { ok: false, error: 'admin secret required (?secret=)' });

  const days = Math.min(60, parseInt(q.days || '21', 10) || 21);
  const chunk = Math.max(1, Math.min(7, parseInt(q.chunk || '4', 10) || 4));
  const now = Date.now();
  const byCall = new Map();
  const windows = [];
  let errs = 0;

  for (let off = 0; off < days; off += chunk) {
    const to = new Date(now - off * 86400000);
    const from = new Date(now - Math.min(days, off + chunk) * 86400000);
    let r;
    try { r = await sp.getCallInfo({ fromDateTime: fmt(from), toDateTime: fmt(to) }); }
    catch (e) { errs++; continue; }
    windows.push({ from: fmt(from), to: fmt(to), ok: r.ok, found: (r.calls || []).length });
    for (const c of (r.calls || [])) if (c.call_number) byCall.set(c.call_number, c);
  }

  const jobs = [...byCall.values()].sort((a, b) => String(a.schedule_date).localeCompare(String(b.schedule_date)));
  const byStatus = {};
  const byState = {};
  for (const j of jobs) {
    byStatus[j.status || 'UNKNOWN'] = (byStatus[j.status || 'UNKNOWN'] || 0) + 1;
    if (j.state) byState[j.state] = (byState[j.state] || 0) + 1;
  }
  // things that may need attention
  const today = new Date(); const todayStr = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;
  const needsAccept = jobs.filter((j) => /open/i.test(j.status));
  const scheduledPast = jobs.filter((j) => j.schedule_date && j.schedule_date < todayStr && !/complete|cancel/i.test(j.status));

  return json(200, {
    ok: true,
    total_jobs: jobs.length,
    by_status: byStatus,
    by_state: byState,
    needs_accept: needsAccept.map((j) => ({ call: j.call_number, who: `${j.first_name} ${j.last_name}`.trim(), appliance: `${j.brand} ${j.product}`.trim(), city: j.city, state: j.state })),
    scheduled_in_past_not_done: scheduledPast.map((j) => ({ call: j.call_number, who: `${j.first_name} ${j.last_name}`.trim(), sched: j.schedule_date, status: j.status })),
    jobs: jobs.map((j) => ({
      call: j.call_number, status: j.status, sub: j.sub_status, sp_id: j.sp_status_id,
      who: `${j.first_name} ${j.last_name}`.trim(), city: j.city, state: j.state,
      appliance: `${j.brand} ${j.product}`.trim(), model: j.model,
      sched: j.schedule_date, window: j.schedule_time, warranty: j.warranty_type,
      problem: (j.problem || '').slice(0, 90), created: j.created_on,
    })),
    windows, errs,
  });
};
