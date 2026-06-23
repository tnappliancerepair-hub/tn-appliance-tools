// delete-attachment — remove a photo/video from a job (tech can't un-attach a
// wrong picture otherwise). Lee put pictures on the wrong customer and had no
// way to remove them (Teddy/Lee 2026-06-23). Deletes the job_attachments row
// via the Metadata API so it disappears from every surface (tech app, Teddy
// Tool, Media Board, office board). Audited to event_log.
//
//   POST { attachment_id, job_id?, actor? }  ->  { ok }
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
  if (!attachmentId) return j(400, { ok: false, error: 'attachment_id required' });
  const jobId = parseInt(b.job_id, 10) || 0;
  const actor = String(b.actor || 'tech').slice(0, 40);

  const h = headers();
  if (!h) return j(500, { ok: false, error: 'not configured (XANO_METADATA_TOKEN)' });

  // Grab the row first (for the audit trail / so we know its s3_key + job).
  let row = null;
  try {
    const r = await fetch(`${META}/table/${JOB_ATTACHMENTS}/content/${attachmentId}`, { headers: h });
    if (r.ok) row = await r.json().catch(() => null);
  } catch (_) {}

  // Delete the attachment row.
  let deleted = false;
  try {
    const r = await fetch(`${META}/table/${JOB_ATTACHMENTS}/content/${attachmentId}`, { method: 'DELETE', headers: h });
    deleted = r.ok;
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return j(200, { ok: false, error: 'delete_failed', status: r.status, detail: txt.slice(0, 200) });
    }
  } catch (e) {
    return j(200, { ok: false, error: String(e.message || e) });
  }

  // Audit (best-effort).
  try {
    await fetch(`${META}/table/${EVENT_LOG}/content`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        action: 'attachment_deleted',
        metadata: { attachment_id: attachmentId, job_id: jobId || (row && row.job_id) || 0, s3_key: (row && row.s3_key) || '', actor, at_ms: Date.now() },
      }),
    });
  } catch (_) {}

  return j(200, { ok: true, deleted, attachment_id: attachmentId });
};
