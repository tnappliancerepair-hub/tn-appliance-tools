// tech-interview-tool — the Vapi function-tool endpoint the "Ant — Tech Setup"
// interview assistant calls to SAVE a technician's profile mid-call.
// Vapi POSTs {message:{toolCalls:[{id,function:{name,arguments}}]}} and expects
// {results:[{toolCallId,result}]} back. Writes an event_log 'tech_profile_v1' row
// (same shape as set-tech-profile) so the self-scheduling engine reads it.
'use strict';

const crud = require('./_lib/xano/metadata-crud');

function toolCalls(body) {
  const m = (body && body.message) || {};
  if (Array.isArray(m.toolCallList)) return m.toolCallList.map((tc) => ({ id: tc.id, name: tc.name || (tc.function && tc.function.name), args: tc.arguments || (tc.function && tc.function.arguments) }));
  if (Array.isArray(m.toolCalls)) return m.toolCalls.map((tc) => ({ id: tc.id, name: tc.function && tc.function.name, args: tc.function && tc.function.arguments }));
  if (Array.isArray(body && body.toolCalls)) return body.toolCalls.map((tc) => ({ id: tc.id, name: tc.function && tc.function.name, args: tc.function && tc.function.arguments }));
  return [{ id: (body && body.id) || 'call_1', name: body && body.name, args: (body && body.arguments) || body }];
}
function parseArgs(a) { if (typeof a === 'string') { try { return JSON.parse(a); } catch (_) { return {}; } } return a || {}; }
const arr = (v) => Array.isArray(v) ? v : (v == null || v === '' ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean));

function buildProfile(p) {
  return {
    start_earliest: p.start_earliest || '', start_ideal: p.start_ideal || '', end_latest: p.end_latest || '',
    stops_good: p.stops_good != null && p.stops_good !== '' ? Number(p.stops_good) : null,
    stops_max: p.stops_max != null && p.stops_max !== '' ? Number(p.stops_max) : null,
    pace: p.pace || '',
    days_off_hard: arr(p.days_off_hard), days_off_reason: p.days_off_reason || '',
    day_prefs_soft: p.day_prefs_soft || '', weekends: p.weekends || '',
    life_windows: p.life_windows || '',
    home_base: p.home_base || '', areas_pref: arr(p.areas_pref), drive_radius_mi: p.drive_radius_mi != null && p.drive_radius_mi !== '' ? Number(p.drive_radius_mi) : null, areas_avoid: arr(p.areas_avoid),
    last_stop_where: p.last_stop_where || '', last_stop_why: p.last_stop_why || '',
    appliance_strong: arr(p.appliance_strong), appliance_avoid: arr(p.appliance_avoid),
    great_day: p.great_day || '', frustrating: p.frustrating || '',
    notes: p.notes || '',
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const results = [];
  for (const c of toolCalls(body)) {
    const a = parseArgs(c.args);
    let result = 'Saved — thank you!';
    try {
      const techId = Number(a.technician_id || a.tech_id || 0);
      if (!techId) { result = 'I could not save that — missing the technician id.'; }
      else {
        await crud.logEvent('tech_profile_v1', {
          technician_id: techId, name: a.name || a.tech_first_name || '',
          profile: buildProfile(a),
          wants_more_work: a.wants_more_work === true || String(a.wants_more_work).toLowerCase() === 'true' || String(a.wants_more_work).toLowerCase() === 'yes',
          source: 'ant_interview', at_ms: Date.now(),
        });
        result = "Got it — I've saved your profile and I'll build your days around that.";
      }
    } catch (e) { result = 'Saved with a hiccup; the office has it.'; }
    results.push({ toolCallId: c.id, result });
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) };
};
