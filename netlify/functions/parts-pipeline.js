// parts-pipeline — the OTHER side of the 21-day cycle: jobs stuck waiting on parts,
// how long they've been stuck, and how many are past their promised arrival (ETA).
// This is where the long tail of the cycle hides (intake -> diagnose -> order ->
// wait -> 2nd visit).
//   GET ?secret=
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function ms(v) { if (v == null || v === '') return 0; if (typeof v === 'number') return v > 1e12 ? v : v * 1000; const t = Date.parse(v); return isNaN(t) ? 0 : t; }
function stats(a) { a = a.filter((x) => x >= 0).sort((x, y) => x - y); if (!a.length) return { n: 0 }; const m = Math.floor(a.length / 2); return { n: a.length, median: Math.round((a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) * 10) / 10, avg: Math.round(a.reduce((s, x) => s + x, 0) / a.length * 10) / 10, max: Math.round(a[a.length - 1] * 10) / 10 }; }
const DAY = 86400000;

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  // jobs currently parked on parts
  let jobs = [];
  try { jobs = await crud.searchPage(crud.TABLES.jobs, { scheduling_status: 'awaiting_parts' }, { id: 'desc' }, 400); } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }

  const now = Date.now();
  const ages = [], overdue = [], noEta = [], byPartsStatus = {};
  const rows = [];
  for (const j of jobs) {
    const created = ms(j.created_at);
    const ageDays = created ? (now - created) / DAY : 0;
    ages.push(ageDays);
    const ps = String(j.parts_status || 'unknown').toLowerCase();
    byPartsStatus[ps] = (byPartsStatus[ps] || 0) + 1;
    const eta = ms(j.parts_eta_date);
    const isOverdue = eta && eta < now;
    if (!eta) noEta.push(j.id);
    if (isOverdue) overdue.push({ id: j.id, eta_days_ago: Math.round((now - eta) / DAY * 10) / 10 });
    rows.push({ id: j.id, appliance: j.appliance_type, parts_status: ps, age_days: Math.round(ageDays * 10) / 10, eta: j.parts_eta_date || null, overdue: !!isOverdue });
  }
  rows.sort((a, b) => b.age_days - a.age_days);

  return json(200, {
    ok: true,
    jobs_awaiting_parts: jobs.length,
    days_stuck: stats(ages),
    overdue_past_eta: overdue.length,
    no_eta_set: noEta.length,
    by_parts_status: byPartsStatus,
    note: 'days_stuck = days since job created (proxy for time in pipeline). overdue = parts_eta_date already passed but job still waiting. no_eta_set = ordered but no ETA tracked (blind spots).',
    oldest_10: rows.slice(0, 10),
    most_overdue: overdue.sort((a, b) => b.eta_days_ago - a.eta_days_ago).slice(0, 8),
  });
};
