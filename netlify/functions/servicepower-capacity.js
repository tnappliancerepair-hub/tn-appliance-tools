// servicepower-capacity — READ our ServicePower tech capacity (the "get more work" lever).
// getTechInfo returns each tech's Key (TechKey) + current weekly BasicCapacity per
// day × time band. This shows whether we're throttled (e.g. capped at N/day) and yields
// the TechKeys needed to RAISE capacity. READ-ONLY — never writes.
//
//   GET ?secret=<admin>          list all techs + current capacity
//   GET ?secret=<admin>&key=<K>  one tech
'use strict';
const sp = require('./_lib/servicepower');
const { getSecret } = require('./_lib/secrets');
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: '?secret= required' });
  if (!(await sp.isConfigured())) return json(200, { ok: false, error: 'ServicePower creds not in vault' });

  let r;
  try { r = await sp.getTechInfo({ key: q.key || undefined }); }
  catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }

  // summarize per tech: total daily capacity (sum of ALL-DAY band, or max across bands)
  const techs = (r.techs || []).map((t) => {
    const byDay = {};
    for (const c of (t.basic_capacity || [])) {
      const d = c.day || '?'; byDay[d] = byDay[d] || {};
      byDay[d][c.time_band || '?'] = Number(c.capacity || 0);
    }
    return { tech_key: t.key, name: t.name, group_key: t.group_key, capacity_by_day: byDay, raw_bands: t.basic_capacity };
  });

  return json(200, {
    ok: r.ok, error_occurred: r.error_occurred, ack: r.ack,
    err_code: r.err_code, err_desc: r.err_desc, err_cause: r.err_cause,
    tech_count: techs.length,
    time_bands: sp.TIME_BANDS,
    techs,
    note: r.ok ? 'Current capacity per tech × day × time band. To raise: updateTechInfo (recurring) or updateTechCapacity (one date).'
               : 'Read failed — inspect err_code/err_desc + raw_preview.',
    raw_preview: r.ok ? undefined : (r.raw || '').slice(0, 800),
  });
};
