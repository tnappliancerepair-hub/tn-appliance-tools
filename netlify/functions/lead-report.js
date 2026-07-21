// lead-report — "where does the work come from?" Aggregates the lead_attribution
// rows (stamped on every job at intake) so the office can see which pages, channels,
// appliances and job types actually produce jobs — and double down on what works.
//   GET ?secret=<admin>[&days=30]  -> { totals, by_channel, by_landing, by_appliance, by_payer, recent }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const ACTION = 'lead_attribution';
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function tsOf(r, m) { return Number(m.at_ms) || Date.parse(r && r.created_at) || 0; }

function bump(map, key, cash) {
  key = key || '(unknown)';
  if (!map[key]) map[key] = { key, jobs: 0, cash: 0, warranty: 0 };
  map[key].jobs++; if (cash) map[key].cash++; else map[key].warranty++;
}
function ranked(map, n) { return Object.values(map).sort((a, b) => b.jobs - a.jobs).slice(0, n || 25); }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return j(401, { ok: false, error: 'unauthorized — ?secret=' });

  const days = Math.max(1, Math.min(365, parseInt(q.days || '30', 10) || 30));
  const cutoff = Date.now() - days * 86400000;

  let rows = [];
  // per_page caps at ~500 on the metadata content/search endpoint (400s above it).
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: ACTION }, { id: 'desc' }, 500); } catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }

  const byChannel = {}, byLanding = {}, byAppliance = {}, byPayer = {};
  const recent = [];
  let total = 0, cashTotal = 0;
  for (const r of rows) {
    const m = metaOf(r);
    if (tsOf(r, m) < cutoff) continue;
    const cash = String(m.payer || '').toLowerCase() !== 'warranty';
    total++; if (cash) cashTotal++;
    bump(byChannel, m.channel, cash);
    bump(byLanding, m.landing, cash);
    bump(byAppliance, m.appliance, cash);
    bump(byPayer, m.payer || 'unknown', cash);
    if (recent.length < 40) recent.push({ at: tsOf(r, m), landing: m.landing, channel: m.channel, appliance: m.appliance, payer: m.payer, town: m.town, job_id: m.job_id });
  }

  return j(200, {
    ok: true, window_days: days,
    totals: { jobs: total, cash: cashTotal, warranty: total - cashTotal },
    by_channel: ranked(byChannel, 20),
    by_landing: ranked(byLanding, 30),
    by_appliance: ranked(byAppliance, 15),
    by_payer: ranked(byPayer, 10),
    recent,
    note: 'jobs = leads that reached the intake and created a job. Attribution = the page/channel the customer FIRST landed on (first-touch).',
  });
};
