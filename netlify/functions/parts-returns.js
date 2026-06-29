// parts-returns — open parts-returns, deadline-stamped, for the tech view + office.
//   GET ?tech_id=N        → that tech's open returns (no secret; matches dashboard)
//   GET ?all=1&secret=…   → every open return, attributed to each tech (office/owner)
'use strict';
const { loadOpenReturns } = require('./_lib/returns');
const { getSecret } = require('./_lib/secrets');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  const techId = q.tech_id ? Number(q.tech_id) : null;

  if (!techId) {
    // office/owner full view — gated
    const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== admin) return json(401, { ok: false, error: 'pass ?tech_id= (tech view) or ?all=1&secret= (office)' });
  }

  let data;
  try { data = await loadOpenReturns({ techId: techId || undefined }); }
  catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }

  const r = data.returns;
  const overdue = r.filter((x) => x.overdue).length;
  const soon = r.filter((x) => !x.overdue && x.days_left <= 3).length;
  return json(200, {
    ok: true, tech_id: techId || 'all', window_days: data.window_days,
    count: r.length, overdue, due_soon: soon,
    returns: r,
    note: 'window_days is a placeholder pending Danielle — set RETURN_WINDOW_DAYS to the real return window.',
  });
};
