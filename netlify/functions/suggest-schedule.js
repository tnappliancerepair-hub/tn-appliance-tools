// suggest-schedule — Ant's shadow-mode scheduling suggestion for a job:
// "put this one on {day} with {tech}". zip -> cluster -> tech (check_service_zone),
// then the best DAY: densify the tech's route (a day they already have same-cluster
// stops), skip their off-days + Saturdays-if-off, respect max stops. Read-only —
// makes a SUGGESTION, books nothing. The office accepts or rejects (we log both to
// measure how close Ant is to Danielle).
//
//   GET/POST { service_zip, appliance_type?, brand? } -> { ok, suggestion:{...} }

'use strict';

const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TECH_TABLE = 15;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ctDate(ms) { return new Date(Number(ms)).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); }
function offDaysFromContext(ctx) { const m = String(ctx || '').match(/OFF_DAYS=([^;]*)/); return m ? (m[1] || '').split(',').map((s) => s.trim()).filter(Boolean) : []; }

exports.handler = async function (event) {
  let p = {};
  if (event.httpMethod === 'POST') { try { p = JSON.parse(event.body || '{}'); } catch (_) {} }
  else p = event.queryStringParameters || {};
  const zip = String(p.service_zip || p.zip || '').replace(/\D/g, '').slice(0, 5);
  const brand = String(p.brand || '').toLowerCase();
  if (!zip) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'service_zip required' }) };

  // 1) zip -> cluster + tech
  let zone = {};
  try { zone = await (await fetch(`${XANO}/check_service_zone?zip_code=${zip}`)).json(); } catch (_) {}
  if (!zone || !zone.covered || !zone.suggested_technician_id) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, suggestion: null, reason: zone && !zone.covered ? 'zip not in a service zone yet' : 'no tech covers this area yet', cluster: (zone && zone.cluster) || '' }) };
  }
  const techId = zone.suggested_technician_id;
  const cluster = zone.cluster || '';

  // 2) tech route + profile
  let rd = {};
  try { rd = await (await fetch(`${XANO}/get_tech_route_days?technician_id=${techId}`)).json(); } catch (_) {}
  const maxStops = Number(rd.max_stops_per_day) || 6;
  const worksSat = rd.works_saturdays !== false;
  const stops = Array.isArray(rd.stops) ? rd.stops : [];
  let personalCtx = '';
  try { const t = await crud.searchPage(TECH_TABLE, { id: techId }, null, 1); personalCtx = (t && t[0] && t[0].personal_context) || ''; } catch (_) {}
  const offDays = offDaysFromContext(personalCtx);
  const brandExcl = String(rd.brand_exclusions || '').toLowerCase();
  const brandConflict = !!(brand && brandExcl && brandExcl.includes(brand));

  // stops per day + clusters that day
  const byDay = {};
  for (const s of stops) {
    const d = ctDate(s.scheduled_start_ms);
    (byDay[d] = byDay[d] || { count: 0, clusters: new Set() });
    byDay[d].count++; byDay[d].clusters.add(s.cluster || '');
  }

  // 3) score the next 10 candidate days
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  let best = null;
  for (let i = 1; i <= 10; i++) {
    const dt = new Date(today); dt.setDate(dt.getDate() + i);
    const wd = dt.getDay();
    const wdName = DOW[wd];
    const ds = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    if (wd === 0) continue;                       // Sunday off by default
    if (wd === 6 && !worksSat) continue;          // Saturday if they work it
    if (offDays.includes(wdName)) continue;       // their recurring days off
    const day = byDay[ds] || { count: 0, clusters: new Set() };
    if (day.count >= maxStops) continue;          // full
    const sameCluster = day.clusters.has(cluster);
    const score = (sameCluster ? 100 : 0) - day.count * 6 - i;  // densify > lighter > sooner
    if (!best || score > best.score) best = { ds, score, count: day.count, sameCluster, wdName };
  }
  if (!best) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, suggestion: { suggested_technician_id: techId, suggested_tech_name: zone.suggested_tech_name, suggested_date: '', cluster, brand_conflict: brandConflict }, reason: 'no open day in the next 10 (tech full or off) — pick a day manually' }) };
  }

  const label = new Date(best.ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  let reason = best.sameCluster
    ? (zone.suggested_tech_name + ' is already in ' + cluster + ' that day')
    : (best.count === 0 ? (zone.suggested_tech_name + "'s lightest open day") : (zone.suggested_tech_name + ' has room (' + best.count + ' stops)'));
  if (brandConflict) reason += ' — heads up: ' + zone.suggested_tech_name + " doesn't do " + brand;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      suggestion: {
        suggested_technician_id: techId,
        suggested_tech_name: zone.suggested_tech_name,
        suggested_date: best.ds,
        suggested_day_label: label,
        cluster, brand_conflict: brandConflict,
      },
      reason,
    }),
  };
};
