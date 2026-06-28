// set-tech-profile — store a technician's work-style/life profile (the input the
// self-scheduling engine clusters around). Written as an event_log row
// (action 'tech_profile_v1') so the colony-loop scheduler can read it with no XS.
// HARD fields filter days/slots out; SOFT fields score the options.
//   POST { secret, technician_id, name?, profile:{...} }   (or flat fields)
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }

// normalize whatever shape comes in into the canonical profile
function buildProfile(b) {
  const p = b.profile && typeof b.profile === 'object' ? b.profile : b;
  const arr = (v) => Array.isArray(v) ? v : (v == null || v === '' ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean));
  return {
    // hours & pace
    start_earliest: p.start_earliest || '', start_ideal: p.start_ideal || '', end_latest: p.end_latest || '',
    stops_good: p.stops_good != null ? Number(p.stops_good) : null,
    stops_max: p.stops_max != null ? Number(p.stops_max) : null,
    pace: p.pace || '', // 'packed' | 'steady'
    // days  (HARD days off = never schedule)
    days_off_hard: Array.isArray(p.days_off_hard) ? p.days_off_hard : arr(p.days_off_hard), // ['Tue'] or [{day,reason}]
    days_off_reason: p.days_off_reason || '',
    day_prefs_soft: p.day_prefs_soft || '',
    weekends: p.weekends || '', // 'never' | 'sometimes' | 'yes'
    // life windows to work around
    life_windows: p.life_windows || '',
    // geography
    home_base: p.home_base || '', areas_pref: arr(p.areas_pref), drive_radius_mi: p.drive_radius_mi != null ? Number(p.drive_radius_mi) : null, areas_avoid: arr(p.areas_avoid),
    // skills
    appliance_strong: arr(p.appliance_strong), appliance_avoid: arr(p.appliance_avoid),
    // the human bar
    great_day: p.great_day || '', frustrating: p.frustrating || '',
    notes: p.notes || '',
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (b.secret !== admin) return j(401, { ok: false, error: 'unauthorized' });
  const techId = Number(b.technician_id || 0);
  if (!techId) return j(400, { ok: false, error: 'technician_id required' });

  const profile = buildProfile(b);
  try {
    await crud.logEvent('tech_profile_v1', { technician_id: techId, name: b.name || '', profile, at_ms: Date.now() });
    return j(200, { ok: true, technician_id: techId, profile });
  } catch (e) {
    return j(500, { ok: false, error: String((e && e.message) || e) });
  }
};
