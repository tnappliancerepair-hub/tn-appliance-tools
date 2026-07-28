// office-staff-verify — per-person office logins (identity + PIN), layered on top
// of the shared office password. Each staffer signs in once on their own device
// with their PIN → their work is attributed to THEM (not the hardcoded "Danielle"),
// and a departing person's login is revoked by removing them here — no effect on
// anyone else.
//
//   GET  ?list=1                         -> { ok, staff:[{name, role}] }  (no PINs)
//   POST { name, pin }                   -> { ok, name, role }            (verify)
//   GET  ?seed=1&secret=<admin>[&reset=1]-> { ok, staff:[{name,role,pin}] } (owner: create/reset roster w/ fresh PINs)
'use strict';
const { getSecret, setSecret } = require('./_lib/secrets');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

const ROSTER = [ // seed identities (roles: owner / manager / office)
  { name: 'Teddy', role: 'owner' },
  { name: 'Danielle', role: 'manager' },
  { name: 'Sofia', role: 'office' },
  { name: 'Alec', role: 'office' },
];
function pin4() { return String(Math.floor(1000 + Math.random() * 9000)); }

async function loadStaff() {
  try { const raw = await getSecret('OFFICE_STAFF'); if (raw) { const a = JSON.parse(raw); if (Array.isArray(a) && a.length) return a; } } catch (_) {}
  return null;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};

  // owner: create or reset the roster with fresh PINs (returns them ONCE)
  if (q.seed === '1') {
    const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
    let staff = await loadStaff();
    if (!staff || q.reset === '1') staff = ROSTER.map((r) => ({ ...r, pin: pin4(), active: true }));
    else staff = staff.map((r) => ({ ...r, pin: r.pin || pin4(), active: r.active !== false })); // fill any missing pins
    try { await setSecret('OFFICE_STAFF', JSON.stringify(staff)); } catch (e) { return json(200, { ok: false, error: 'vault write failed: ' + String((e && e.message) || e) }); }
    return json(200, { ok: true, staff: staff.map((r) => ({ name: r.name, role: r.role, pin: r.pin, active: r.active })) });
  }

  const staff = (await loadStaff()) || [];

  if (event.httpMethod === 'GET') {
    return json(200, { ok: true, staff: staff.filter((r) => r.active !== false).map((r) => ({ name: r.name, role: r.role })) });
  }

  // POST → verify name + pin
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const name = String(b.name || '').trim();
  const pin = String(b.pin || '').trim();
  if (!name || !pin) return json(400, { ok: false, error: 'name and pin required' });
  const rec = staff.find((r) => r.active !== false && String(r.name).toLowerCase() === name.toLowerCase() && String(r.pin) === pin);
  if (!rec) return json(200, { ok: false, error: 'wrong name or PIN' });
  return json(200, { ok: true, name: rec.name, role: rec.role });
};
