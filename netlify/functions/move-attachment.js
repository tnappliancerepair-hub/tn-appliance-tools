// move-attachment — re-link a photo/video/signature from one job to another via
// the Metadata API. Built 2026-07-10: Andre logged Jude's completed start-button
// repair (photos + walk-around video + customer signature) onto Kiendra's stop by
// mistake; those attachments belong on Jude's job for the warranty claim. Mirrors
// delete-attachment's metadata pattern but PUTs a new job_id instead of deleting.
//
//   POST { attachment_id, to_job_id, actor? }  ->  { ok, attachment_id, to_job_id }
'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const JOB_ATTACHMENTS = 22;
const EVENT_LOG = 3;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) return null;
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function j(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(200, { ok: true });
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'method_not_allowed' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return j(400, { ok: false, error: 'invalid_json' }); }
  const attachmentId = parseInt(b.attachment_id, 10);
  const toJobId = parseInt(b.to_job_id, 10);
  if (!attachmentId || !toJobId) return j(400, { ok: false, error: 'attachment_id + to_job_id required' });
  const actor = String(b.actor || 'office').slice(0, 40);

  const h = headers();
  if (!h) return j(500, { ok: false, error: 'not configured (XANO_METADATA_TOKEN)' });

  // Read the row first (preserve fields; PUT with partial body is safest but we
  // send the whole row back with only job_id changed).
  let row = null;
  try {
    const r = await fetch(`${META}/table/${JOB_ATTACHMENTS}/content/${attachmentId}`, { headers: h });
    if (r.ok) row = await r.json().catch(() => null);
  } catch (_) {}
  if (!row) return j(404, { ok: false, error: 'attachment_not_found', attachment_id: attachmentId });

  const fromJobId = row.job_id;
  const updated = Object.assign({}, row, { job_id: toJobId });

  // PUT (not PATCH — Metadata content API 404s on PATCH; PUT preserves fields).
  try {
    const r = await fetch(`${META}/table/${JOB_ATTACHMENTS}/content/${attachmentId}`, { method: 'PUT', headers: h, body: JSON.stringify(updated) });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return j(200, { ok: false, error: 'move_failed', status: r.status, detail: txt.slice(0, 200) });
    }
  } catch (e) {
    return j(200, { ok: false, error: String(e.message || e) });
  }

  try {
    await fetch(`${META}/table/${EVENT_LOG}/content`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ action: 'attachment_moved', metadata: { attachment_id: attachmentId, from_job_id: fromJobId, to_job_id: toJobId, s3_key: row.s3_key || '', actor, at_ms: Date.now() } }),
    });
  } catch (_) {}

  return j(200, { ok: true, attachment_id: attachmentId, from_job_id: fromJobId, to_job_id: toJobId });
};
