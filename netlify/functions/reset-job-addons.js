// reset-job-addons — admin tool to wipe the add-on records for ONE job (used when
// add-ons were logged during testing). Deletes the event_log rows
// (addon_fulfilled / addon_requested) for that job so they drop off tech pay,
// office payroll, the to-ship/quote worklist, and the board banner.
//
//   GET ?secret=<admin>&job_id=<id>            DRY RUN — lists what it would delete
//   GET ?secret=<admin>&job_id=<id>&confirm=1  actually deletes
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG = 3;
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const jobId = parseInt(q.job_id, 10);
  if (!jobId) return json(400, { ok: false, error: 'job_id required' });
  const token = process.env.XANO_METADATA_TOKEN;
  if (!token) return json(500, { ok: false, error: 'no metadata token' });
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const dry = q.confirm !== '1';

  // find every add-on row tied to this job
  const found = [];
  for (const action of ['addon_fulfilled', 'addon_requested']) {
    let rows = [];
    try { rows = await crud.searchPage(EVENT_LOG, { action }, { created_at: 'desc' }, 500); } catch (_) {}
    for (const r of rows) {
      let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } m = m || {};
      if (parseInt(m.job_id, 10) === jobId) {
        found.push({ id: r.id, action, addon_key: m.addon_key || '', name: m.name || '', tech_cut: m.tech_cut, status: m.status || '' });
      }
    }
  }

  if (dry) return json(200, { ok: true, mode: 'dryrun', job_id: jobId, count: found.length, would_delete: found, note: 'Add &confirm=1 to delete.' });

  const deleted = [], failed = [];
  for (const f of found) {
    try {
      const r = await fetch(`${META}/table/${EVENT_LOG}/content/${f.id}`, { method: 'DELETE', headers });
      if (r.ok) deleted.push(f.id); else failed.push({ id: f.id, status: r.status });
    } catch (e) { failed.push({ id: f.id, error: String((e && e.message) || e) }); }
  }
  return json(200, { ok: true, mode: 'deleted', job_id: jobId, deleted_count: deleted.length, deleted, failed });
};
