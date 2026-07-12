// fix-tech-missing-parts — one-time cleanup. Before the "📦 Please order" button
// existed, techs (Jimmy) had no way to flag a diagnosed part that needed ordering,
// so they marked it "Missing" — which is really the chargeback-shield flag (part
// never arrived / no core to return). This finds every warranty part whose CURRENT
// status is 'missing' set by a given tech and flips it to 'to_order' (needs
// ordering) so it shows up correctly on Danielle's sourcing list.
//
//   GET ?secret=<admin>&tech_id=2            -> DRY RUN, lists what would change
//   GET ?secret=<admin>&tech_id=2&confirm=1  -> flips them to 'to_order'
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const techId = Number(q.tech_id || 2);   // 2 = Jimmy
  const confirm = q.confirm === '1';

  // Walk recent warranty_part_status history, newest first. The FIRST time we see a
  // (job_id, part) pair is its current status (latest-wins).
  const seen = new Set();
  const latest = [];
  try {
    for (let page = 1; page <= 8; page++) {
      const rows = await crud.searchPageN(crud.TABLES.event_log, { action: 'warranty_part_status' }, { id: 'desc' }, 500, page);
      if (!rows || !rows.length) break;
      for (const r of rows) {
        const m = (r && r.metadata) || {};
        const key = String(m.job_id) + '|' + String(m.part);
        if (seen.has(key)) continue;
        seen.add(key);
        latest.push({ job_id: Number(m.job_id) || 0, part: String(m.part || ''), status: String(m.status || ''), technician_id: Number(m.technician_id || 0), by: String(m.by || ''), at_ms: Number(m.at_ms) || 0 });
      }
      if (rows.length < 500) break;
    }
  } catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }

  const targets = latest.filter((x) => x.status === 'missing' && x.technician_id === techId && x.job_id && x.part);

  if (!confirm) {
    return json(200, { ok: true, dry_run: true, tech_id: techId, would_fix: targets.length, parts: targets.map((t) => ({ job_id: t.job_id, part: t.part, at: t.at_ms ? new Date(t.at_ms).toISOString().slice(0, 10) : '' })) });
  }

  let fixed = 0;
  const results = [];
  for (const t of targets) {
    try {
      await crud.logEvent('warranty_part_status', { job_id: t.job_id, part: t.part, status: 'to_order', by: 'office', technician_id: techId, at_ms: Date.now(), note: 'bulk cleanup: was mislabeled missing before the Please-order button existed' });
      fixed++; results.push({ job_id: t.job_id, part: t.part, ok: true });
    } catch (e) { results.push({ job_id: t.job_id, part: t.part, ok: false, error: String(e.message || e) }); }
  }
  return json(200, { ok: true, tech_id: techId, fixed, total: targets.length, results });
};
