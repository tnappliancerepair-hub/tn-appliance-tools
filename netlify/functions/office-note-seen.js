// office-note-seen — the tech's read receipt for the office's job notes. When a
// tech opens a job and its office notes render, his app calls this; it records
// an event_log 'office_note_seen' row so the office can see "✓ seen by <tech>".
// (Teddy 2026-07-03)
//
//   POST { job_id, tech_id }  ->  { ok }
'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG = 3;
const TECHS = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 5: 'Billy', 6: 'John' };

function h() { const t = process.env.XANO_METADATA_TOKEN; return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null; }
function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = Number(b.job_id || 0);
  const techId = Number(b.tech_id || 0);
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });
  const hh = h();
  if (!hh) return j(500, { ok: false, error: 'metadata token not configured' });
  try {
    await fetch(`${META}/table/${EVENT_LOG}/content`, {
      method: 'POST', headers: hh,
      body: JSON.stringify({ action: 'office_note_seen', metadata: { job_id: jobId, tech_id: techId, tech: TECHS[techId] || '', at_ms: Date.now() } }),
    });
    return j(200, { ok: true });
  } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
};
