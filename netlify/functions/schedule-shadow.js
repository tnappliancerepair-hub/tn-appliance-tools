// schedule-shadow — turns "is auto-scheduling any good?" into a NUMBER.
// Takes jobs a human already scheduled (tech + day set), re-runs the cluster
// suggester (check_service_zone → suggested_technician_id) against each, and
// reports the agreement rate + WHERE it misses (data holes vs real disagreement).
//
// This is the dread-killer: watch the agreement % and the data-hole list. High
// agreement → start auto-accepting the obvious ones. Low → the misses point
// straight at the feed (unmapped zips, uncovered clusters) to fix.
//
//   GET ?limit=300  -> { ok, scored, agreement_rate, buckets:{...}, data_holes:{...}, misses:[...] }

'use strict';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

exports.handler = async function (event) {
  const limit = Math.min(Math.max(parseInt((event.queryStringParameters || {}).limit, 10) || 300, 10), 1000);

  let jobs = [];
  try {
    const r = await fetch(`${XANO}/list_jobs_for_office_map?limit=${limit}`);
    const d = await r.json().catch(() => ({}));
    jobs = Array.isArray(d) ? d : (d.jobs || d.items || []);
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }

  // only jobs a human actually placed: has a tech AND a scheduled day
  const placed = jobs.filter((j) => j && j.technician_id && j.scheduled_start);

  // cache zip -> service-zone result (many jobs share a zip)
  const zoneCache = {};
  async function zone(zip) {
    const z = String(zip || '').replace(/\D/g, '').slice(0, 5);
    if (!z || z.length < 5) return null;
    if (zoneCache[z] !== undefined) return zoneCache[z];
    try {
      const r = await fetch(`${XANO}/check_service_zone?zip_code=${z}`);
      zoneCache[z] = await r.json().catch(() => null);
    } catch (_) { zoneCache[z] = null; }
    return zoneCache[z];
  }

  const buckets = { matched: 0, mismatched: 0, no_suggestion: 0, no_zip: 0, not_covered: 0 };
  const misses = [];
  for (const j of placed) {
    if (!j.zip) { buckets.no_zip++; continue; }
    const zr = await zone(j.zip);
    if (!zr || zr.covered === false) { buckets.not_covered++; continue; }
    const suggested = zr.suggested_technician_id || null;
    if (!suggested) { buckets.no_suggestion++; continue; }
    if (Number(suggested) === Number(j.technician_id)) {
      buckets.matched++;
    } else {
      buckets.mismatched++;
      if (misses.length < 40) misses.push({ job_id: j.job_id, zip: j.zip, cluster: zr.cluster || '', suggested_tech: suggested, actual_tech: j.technician_id, city: j.city || '' });
    }
  }

  const scored = buckets.matched + buckets.mismatched;
  const agreement_rate = scored ? Math.round((buckets.matched / scored) * 100) : null;

  return {
    statusCode: 200, headers: CORS, body: JSON.stringify({
      ok: true,
      placed_jobs: placed.length,
      scored,
      agreement_rate, // % of human-scheduled jobs where the suggester picked the SAME tech
      buckets,
      data_holes: { no_zip: buckets.no_zip, not_covered: buckets.not_covered, no_suggestion: buckets.no_suggestion },
      misses,
    }),
  };
};
