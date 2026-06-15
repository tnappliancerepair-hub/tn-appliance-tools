// tech-prefs — read + save technician scheduling preferences for the office
// editor (office-password gated, no tech PIN needed since the OFFICE sets these).
// Writes the technicians row via the Metadata API. Recurring days off are stored
// in personal_context with a parseable tag "OFF_DAYS=Mon,Wed;;<note>" so they
// round-trip AND the routing layer can read them later.
//
//   GET                              -> { ok, techs:[{id,name,...prefs}] }
//   POST { office_password, tech_id, ...fields } -> save (verified)

'use strict';

const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TECH_TABLE = 15;
const ACTIVE_IDS = [1, 2, 3, 4, 6]; // Teddy, Jimmy, Andre, Lee, John (Billy left)
const NAMES = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 6: 'John' };

function shape(t) {
  return {
    id: t.id,
    name: NAMES[t.id] || ((t.first_name || '') + ' ' + (t.last_name || '')).trim(),
    max_stops_per_day: t.max_stops_per_day != null ? t.max_stops_per_day : 6,
    works_saturdays: !!t.works_saturdays,
    appliance_specialties: t.appliance_specialties || '',
    brand_exclusions: t.brand_exclusions || '',
    home_zone: t.home_zone || '',
    preferred_hours_start: t.preferred_hours_start || '',
    preferred_hours_end: t.preferred_hours_end || '',
    personal_context: t.personal_context || '',
  };
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod === 'GET') {
      const rows = await crud.searchPage(TECH_TABLE, {}, { id: 'asc' }, 50);
      const techs = (rows || []).filter((t) => ACTIVE_IDS.includes(t.id)).map(shape);
      // keep dropdown order = ACTIVE_IDS order
      techs.sort((a, b) => ACTIVE_IDS.indexOf(a.id) - ACTIVE_IDS.indexOf(b.id));
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, techs }) };
    }
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const b = JSON.parse(event.body || '{}');
    // verify the office password server-side
    const vr = await fetch(`${XANO}/verify_office_password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: String(b.office_password || '') }),
    });
    const vd = await vr.json().catch(() => ({}));
    if (!vd || !vd.success) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'wrong office password' }) };

    const techId = parseInt(b.tech_id, 10);
    if (!ACTIVE_IDS.includes(techId)) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'unknown tech' }) };

    const partial = {};
    if (b.max_stops_per_day != null && b.max_stops_per_day !== '') partial.max_stops_per_day = parseInt(b.max_stops_per_day, 10) || 0;
    if (typeof b.works_saturdays === 'boolean') partial.works_saturdays = b.works_saturdays;
    if (b.appliance_specialties != null) partial.appliance_specialties = String(b.appliance_specialties);
    if (b.brand_exclusions != null) partial.brand_exclusions = String(b.brand_exclusions);
    if (b.home_zone != null) partial.home_zone = String(b.home_zone);
    if (b.preferred_hours_start != null) partial.preferred_hours_start = String(b.preferred_hours_start);
    if (b.preferred_hours_end != null) partial.preferred_hours_end = String(b.preferred_hours_end);
    if (b.personal_context != null) partial.personal_context = String(b.personal_context);

    await crud.update(TECH_TABLE, techId, partial);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, success: true, tech_id: techId, saved: partial }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
