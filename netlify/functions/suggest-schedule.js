// suggest-schedule — Ant's shadow-mode cluster placement for a job:
// "put this one on {day} with {tech}". zip -> cluster -> tech (check_service_zone),
// then the best DAY: (1) HONOR the customer's availability (only days they said
// they're free, never a day they said they can't), (2) densify the tech's route
// (a day they already have same-cluster stops), (3) skip off-days/Saturdays-if-off,
// respect max stops, prefer sooner. Read-only — makes a SUGGESTION, books nothing.
//
//   GET/POST { service_zip, appliance_type?, brand?, job_id? } -> { ok, suggestion:{...} }

'use strict';

const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TECH_TABLE = 15;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ctDate(ms) { return new Date(Number(ms)).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); }
function offDaysFromContext(ctx) { const m = String(ctx || '').match(/OFF_DAYS=([^;]*)/); return m ? (m[1] || '').split(',').map((s) => s.trim()).filter(Boolean) : []; }

// ── Availability parsing — turn the customer's free-text / grid into day-of-week
// constraints (0=Sun..6=Sat). availDows = days they CAN do; unavailDows = avoid. ──
const DOW_MAP = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
function dowsFromText(t) {
  const s = String(t || '').toLowerCase(); const out = new Set();
  if (/\b(weekday|week day|during the week|mon[\s-]*(through|to|-)?\s*fri|m[\s-]*-?\s*f|monday[\s-]*(through|to|-)?\s*friday)\b/.test(s)) { [1, 2, 3, 4, 5].forEach((d) => out.add(d)); }
  if (/\bweekend/.test(s)) { out.add(6); out.add(0); }
  for (const k of Object.keys(DOW_MAP)) { if (new RegExp('\\b' + k + '\\b').test(s)) out.add(DOW_MAP[k]); }
  return out;
}
function isAnyDay(t) { return /\b(any\s*day|any\s*time|anytime|whenever|flexible|all\s*week|any day works?|sooner the better|asap|open all)\b/i.test(String(t || '')); }
function availabilityConstraints(pref, unavail, gridJson) {
  const anyDay = isAnyDay(pref);
  const availDows = dowsFromText(pref);
  const unavailDows = dowsFromText(unavail);
  try { const g = JSON.parse(gridJson || '[]'); if (Array.isArray(g)) g.forEach((e) => dowsFromText(e && e.day).forEach((x) => availDows.add(x))); } catch (_) {}
  return { anyDay, availDows, unavailDows, hasAvail: availDows.size > 0 };
}

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

  // 1b) honor the customer's availability (if we've collected it)
  let av = { anyDay: false, availDows: new Set(), unavailDows: new Set(), hasAvail: false };
  const jobId = parseInt(String(p.job_id || '').replace(/\D/g, ''), 10) || 0;
  if (jobId) {
    try {
      const jd = await (await fetch(`${XANO}/get_job_for_dashboard?job_id=${jobId}`)).json();
      const j = (jd && (jd.job || jd)) || {};
      av = availabilityConstraints(j.customer_preference_text, j.customer_unavailability_text, j.customer_availability_grid);
    } catch (_) {}
  }

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
  let best = null, availBlocked = false;
  for (let i = 1; i <= 10; i++) {
    const dt = new Date(today); dt.setDate(dt.getDate() + i);
    const wd = dt.getDay();
    const wdName = DOW[wd];
    const ds = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    if (wd === 0) continue;                       // Sunday off by default
    if (wd === 6 && !worksSat) continue;          // Saturday if they work it
    if (offDays.includes(wdName)) continue;       // their recurring days off
    if (av.unavailDows.has(wd)) { availBlocked = true; continue; }                  // customer said NOT this day
    if (!av.anyDay && av.hasAvail && !av.availDows.has(wd)) { availBlocked = true; continue; } // not in their available days
    const day = byDay[ds] || { count: 0, clusters: new Set() };
    if (day.count >= maxStops) continue;          // full
    const sameCluster = day.clusters.has(cluster);
    const availFit = (av.hasAvail && av.availDows.has(wd)) ? 40 : 0;
    const score = (sameCluster ? 100 : 0) + availFit - day.count * 6 - i;  // densify > fits-availability > lighter > sooner
    if (!best || score > best.score) best = { ds, score, count: day.count, sameCluster, wdName };
  }

  if (!best) {
    const why = availBlocked
      ? 'the only open route days conflict with their availability — pick a day with them'
      : 'no open day in the next 10 (tech full or off) — pick a day manually';
    return { statusCode: 200, body: JSON.stringify({ ok: true, suggestion: { suggested_technician_id: techId, suggested_tech_name: zone.suggested_tech_name, suggested_date: '', cluster, brand_conflict: brandConflict }, reason: why }) };
  }

  const label = new Date(best.ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  let reason = best.sameCluster
    ? (zone.suggested_tech_name + ' is already in ' + cluster + ' that day')
    : (best.count === 0 ? (zone.suggested_tech_name + "'s lightest open day") : (zone.suggested_tech_name + ' has room (' + best.count + ' stops)'));
  if (av.hasAvail || av.unavailDows.size) reason += ' · fits their availability';
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
        honored_availability: !!(av.hasAvail || av.unavailDows.size),
      },
      reason,
    }),
  };
};
