// mark-call-reviewed — writes the 'call_reviewed' event_log marker that
// list_calls_for_review cross-references to drop a call off the review queue.
//
// This exists because the XanoScript endpoint (api/intake/mark_call_reviewed)
// throws a parse error ("wrap your filter with parentheses" — the |trim != ""
// footgun in its precondition), so the "Mark reviewed" button had been failing
// silently and the call log never worked down. This Netlify path writes the
// exact same row via the metadata API — no Mac deploy needed.
//
//   POST { vapi_call_id, reviewed_by?, note? }            -> mark one
//   POST { vapi_call_ids: [...], reviewed_by? }           -> mark many (bulk clear)
'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null;
}
function jsonResp(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }

exports.config = { timeout: 26 };

async function writeReviewed(h, vapiCallId, reviewer, note) {
  const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      action: 'call_reviewed',
      metadata: { vapi_call_id: vapiCallId, reviewed_by: reviewer, note: note || '', ts_ms: Date.now() },
    }),
  });
  if (!r.ok) throw new Error('event_log ' + r.status);
  return true;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return jsonResp(405, { success: false, error: 'Method Not Allowed' });
  const h = headers();
  if (!h) return jsonResp(500, { success: false, error: 'metadata token not configured' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { b = {}; }
  const reviewer = String(b.reviewed_by || 'office').slice(0, 40);
  const note = String(b.note || '').slice(0, 300);

  // Batch mode
  const many = Array.isArray(b.vapi_call_ids) ? b.vapi_call_ids.filter(Boolean).map(String) : null;
  if (many) {
    let ok = 0; const failed = [];
    for (const vid of many) {
      try { await writeReviewed(h, vid.slice(0, 80), reviewer, note); ok++; }
      catch (e) { failed.push({ vapi_call_id: vid, error: String(e.message || e) }); }
    }
    return jsonResp(200, { success: true, marked: ok, failed_count: failed.length, failed });
  }

  const vid = String(b.vapi_call_id || '').trim();
  if (!vid) return jsonResp(400, { success: false, error: 'vapi_call_id required' });
  try {
    await writeReviewed(h, vid.slice(0, 80), reviewer, note);
    return jsonResp(200, { success: true, vapi_call_id: vid, ack: 'Marked reviewed.' });
  } catch (e) {
    return jsonResp(200, { success: false, error: String(e.message || e) });
  }
};
