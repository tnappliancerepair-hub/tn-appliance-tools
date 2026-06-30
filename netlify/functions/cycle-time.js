// cycle-time — the real "start to finish a stop" number, from our own data, broken
// into the stages that matter so we can see WHERE the days are lost:
//   A) intake -> appointment date   (the scheduling lag — what auto-scheduling kills)
//   B) appointment -> completed      (appointment to tech-done; multi-visit adds here)
//   T) intake -> completed           (total cycle)
// Reports median + average + n, overall and split warranty vs cash.
//   GET ?secret=&days=90
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function ms(v) { if (v == null || v === '') return 0; if (typeof v === 'number') return v > 1e12 ? v : v * 1000; const t = Date.parse(v); return isNaN(t) ? 0 : t; }
function stats(arr) {
  const a = arr.filter((x) => x > 0 && x < 365).sort((x, y) => x - y); // days, drop impossible
  if (!a.length) return { n: 0, median: null, avg: null };
  const mid = Math.floor(a.length / 2);
  const median = a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  const avg = a.reduce((s, x) => s + x, 0) / a.length;
  return { n: a.length, median: Math.round(median * 10) / 10, avg: Math.round(avg * 10) / 10, p90: Math.round(a[Math.floor(a.length * 0.9)] * 10) / 10 };
}
const DAY = 86400000;

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const days = Math.max(7, Math.min(365, parseInt(q.days, 10) || 90));
  const sinceMs = Date.now() - days * DAY;

  let jobs = [];
  try { jobs = await crud.searchPage(crud.TABLES.jobs, { scheduling_status: 'completed' }, { id: 'desc' }, 500); } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }

  const buckets = { all: { A: [], B: [], T: [] }, warranty: { A: [], B: [], T: [] }, cash: { A: [], B: [], T: [] } };
  let used = 0, noComplete = 0, noSched = 0;
  for (const j of jobs) {
    const created = ms(j.created_at);
    if (!created || created < sinceMs) continue;
    const sched = ms(j.scheduled_start);
    const done = ms(j.job_completed_at) || ms(j.completed_at) || ms(j.job_complete_at);
    if (!done) { noComplete++; continue; }
    const ct = String(j.customer_type || '').toLowerCase();
    const lane = (ct === 'self_pay' || ct === 'cash' || ct === 'customer_pay') ? 'cash' : 'warranty';
    used++;
    const T = (done - created) / DAY;
    for (const b of [buckets.all, buckets[lane]]) b.T.push(T);
    if (sched && sched > 0) {
      const A = (sched - created) / DAY, B = (done - sched) / DAY;
      for (const b of [buckets.all, buckets[lane]]) { b.A.push(A); b.B.push(B); }
    } else noSched++;
  }

  const fmt = (b) => ({ intake_to_appointment: stats(b.A), appointment_to_completed: stats(b.B), total_intake_to_completed: stats(b.T) });
  return json(200, {
    ok: true, window_days: days, completed_jobs_in_window: used, missing_completed_ts: noComplete, missing_scheduled_ts: noSched,
    note: 'days. intake_to_appointment = the scheduling lag (auto-scheduling target). appointment_to_completed includes multi-visit/parts waits.',
    overall: fmt(buckets.all), warranty: fmt(buckets.warranty), cash: fmt(buckets.cash),
  });
};
