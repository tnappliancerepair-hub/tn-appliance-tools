// auto-place-review — owner-gated window into what the self-scheduling autopilot
// is doing. Reads the auto-place decisions the loop logs to event_log
// ('try_auto_schedule_handled', outcome=auto_placed | auto_place_shadow) so Teddy
// can validate the picks during SHADOW before going live, and audit LIVE placements.
//   GET ?secret=<admin>[&days=3][&mode=shadow|live|all]
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function ctTime(ms) { if (!ms) return ''; try { return new Date(Number(ms)).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; } }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const days = Math.max(1, Math.min(30, parseInt(q.days, 10) || 3));
  const sinceMs = Date.now() - days * 86400000;
  const mode = (q.mode || 'all').toLowerCase();

  let rows = [];
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'try_auto_schedule_handled' }, { id: 'desc' }, 400); }
  catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }

  const placed = [], shadow = []; const outcomeCounts = {};
  for (const r of rows) {
    const createdAt = Number(r.created_at || 0);
    if (createdAt && createdAt < sinceMs) continue;
    const m = meta(r);
    const oc = m.outcome || '';
    outcomeCounts[oc] = (outcomeCounts[oc] || 0) + 1;
    const item = {
      job_id: m.job_id, technician_id: m.technician_id,
      when: ctTime(m.scheduled_start_ms), why: m.why || '',
      profile_applied: !!m.profile_applied, at: ctTime(createdAt),
    };
    if (oc === 'auto_placed') placed.push(item);
    else if (oc === 'auto_place_shadow') shadow.push(item);
  }

  const out = { ok: true, days, since_ct: ctTime(sinceMs), outcome_counts: outcomeCounts };
  if (mode === 'live' || mode === 'all') out.placed_live = placed;
  if (mode === 'shadow' || mode === 'all') out.would_place_shadow = shadow;
  out.summary = `live placed: ${placed.length} · shadow would-place: ${shadow.length} (last ${days}d)`;
  return json(200, out);
};
