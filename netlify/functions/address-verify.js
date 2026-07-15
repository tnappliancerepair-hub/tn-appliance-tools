// address-verify — independent confirmation that a job's address is a REAL, findable place
// (Teddy 2026-07-15: "guys shouldn't worry if it's the right address"). Geocodes the address
// with Google; a street-level rooftop/interpolated single match = VERIFIED, while a
// city/zip-centroid or no match = NOT verified. This catches "1, Nashville" AND typos even
// when the fields look structurally complete, so a green "verified" on the tile is real.
//
//   GET ?address=<full address>            -> { ok, verified, precision, formatted }
//   GET ?job_id=<id>                       -> resolves the job's address, then verifies
'use strict';
exports.config = { timeout: 12 };
const crud = require('./_lib/xano/metadata-crud');
const JOBS = crud.TABLES.jobs, CUSTOMER = crud.TABLES.customer;
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'cache-control': 'max-age=600' }, body: JSON.stringify(b) }; }
const s = (v) => String(v == null ? '' : v).trim();
const digits = (v) => s(v).replace(/\D/g, '');
const hasStreetName = (v) => { v = s(v); return !!v && /[a-z]{2,}/i.test(v.replace(/^\s*\d+[a-z]?\s*/i, '')); };

async function resolveAddress(jobId) {
  try {
    const j = await crud.searchOne(JOBS, { id: jobId }); if (!j) return '';
    const cust = j.customer_id ? (await crud.searchOne(CUSTOMER, { id: j.customer_id })) || {} : {};
    const jStreet = s(j.service_address), cStreet = s(cust.address);
    const street = hasStreetName(jStreet) ? jStreet : (hasStreetName(cStreet) ? cStreet : (jStreet || cStreet));
    const city = s(j.service_city) || s(cust.city), state = s(j.service_state) || s(cust.state);
    const zip = (digits(j.service_zip) || digits(cust.zip)).slice(0, 5);
    return [street, city, state, zip].filter(Boolean).join(', ');
  } catch (_) { return ''; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const key = process.env.GOOGLE_MAPS_API_KEY;
  let address = s(q.address);
  if (!address && q.job_id) address = await resolveAddress(parseInt(q.job_id, 10) || 0);
  if (!address) return json(200, { ok: true, verified: false, precision: 'none', reason: 'no_address' });
  // A street name is a prerequisite; a bare "City, ST zip" can't be verified as a delivery point.
  if (!hasStreetName(address.split(',')[0])) return json(200, { ok: true, verified: false, precision: 'no_street', address });
  if (!key) return json(200, { ok: true, verified: null, precision: 'no_key', address });   // can't confirm — treat as unknown, not false
  try {
    const r = await fetch('https://maps.googleapis.com/maps/api/geocode/json?region=us&address=' + encodeURIComponent(address) + '&key=' + key, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    const res = (d.results || [])[0];
    if (!res) return json(200, { ok: true, verified: false, precision: 'not_found', address });
    const lt = ((res.geometry || {}).location_type) || '';   // ROOFTOP / RANGE_INTERPOLATED / GEOMETRIC_CENTER / APPROXIMATE
    const hasNum = (res.address_components || []).some((c) => (c.types || []).includes('street_number'));
    const hasRoute = (res.address_components || []).some((c) => (c.types || []).includes('route'));
    const verified = (lt === 'ROOFTOP' || lt === 'RANGE_INTERPOLATED') && hasNum && hasRoute && !res.partial_match;
    return json(200, { ok: true, verified, precision: lt, partial: !!res.partial_match, formatted: res.formatted_address, address });
  } catch (e) { return json(200, { ok: true, verified: null, precision: 'error', address }); }
};
