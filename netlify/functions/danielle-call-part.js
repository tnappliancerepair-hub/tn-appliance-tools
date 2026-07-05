// danielle-call-part — Danielle enters the Part Showdown 🎯 (Teddy 7/5).
//
// Office-vs-field competition on the crux friction: the part number. Danielle
// "calls" the part from the office (Marcone/finder); the tech's confirmed part
// is the truth; ant-brain-game grades her call against it and puts her on the
// same leaderboard as the crew + Ant. Person vs person = everyone's motivated.
//
//   POST { job_id, part, by? }  -> { ok, job_id, part }
'use strict';

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const EVENT_LOG = 3;
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(200, { ok: true });
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'POST only' });
  const tok = process.env.XANO_METADATA_TOKEN;
  if (!tok) return j(200, { ok: false, error: 'no metadata token' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const job_id = parseInt(b.job_id, 10);
  const part = String(b.part || '').trim();
  if (!job_id) return j(400, { ok: false, error: 'job_id required' });
  if (!part) return j(400, { ok: false, error: 'part required' });
  try {
    const r = await fetch(`${META}/table/${EVENT_LOG}/content`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'danielle_part_call', metadata: { job_id, part, by: String(b.by || 'Danielle').slice(0, 40), at_ms: Date.now() } }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return j(200, { ok: false, error: 'write failed ' + r.status });
    return j(200, { ok: true, job_id, part });
  } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
};
