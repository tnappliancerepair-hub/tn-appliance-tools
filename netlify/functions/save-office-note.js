// save-office-note — office-authored note on a job (part ETAs, warranty-co
// updates), separate from tech notes. Teddy 7/1: Danielle needs a place to log
// e.g. "Frontdoor part 5-7 days" so the DB reflects it and Ant can tell a caller
// "the part's expected in 5-7 days, per the office note from Jul 1."
//
// Stored as an event_log 'office_note' row (job_id + text + by + at_ms). The
// office-board drawer reads these from the job's events; the phone-lookup path
// reads the latest to relay to callers.
//
//   POST { job_id, text, by? }  ->  { ok }
'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null;
}
function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }

exports.config = { timeout: 20 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'Method Not Allowed' });
  const h = headers();
  if (!h) return j(500, { ok: false, error: 'metadata token not configured' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { b = {}; }
  const jobId = Number(b.job_id || b.jobId || 0);
  const text = String(b.text || '').trim().slice(0, 2000);
  const by = String(b.by || 'office').slice(0, 40);
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });
  if (!text) return j(400, { ok: false, error: 'text required' });

  try {
    const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        action: 'office_note',
        metadata: { job_id: jobId, text, by, at_ms: Date.now() },
      }),
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('event_log ' + r.status + ' ' + t.slice(0, 120)); }
    return j(200, { ok: true, job_id: jobId });
  } catch (e) {
    return j(200, { ok: false, error: String(e.message || e) });
  }
};
