// flag-parts-to-order — when a job is pre-diagnosed with a part that the shop needs to
// ORDER (not a DIY drop-ship, not no-parts), stamp parts_status='to_order' so it lands
// in the "🔩 Parts to Order" folder on the board. That's Danielle's queue to order the
// part + set the ETA — so the tech never rolls before the part arrives (no blind first
// trip). (Teddy 2026-07-24: "direct that job to a place for Danielle to get the parts
// ordered and get an eta.")
//
// It's a light signal only: the moment Danielle sets the ETA (orders), the board's
// existing parts_eta_date rule takes over and the job moves to Waiting Parts — so this
// value is naturally superseded and never traps the job.
//
//   POST { job_id }            -> set parts_status='to_order' (skips if already ordered/arrived)
//   POST { job_id, clear:1 }   -> clear it back to '' (if still to_order)
'use strict';
const crud = require('./_lib/xano/metadata-crud');
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: JSON.stringify(b) }; }

const ORDERED = /(awaiting_parts|ordered|on_order|backorder|arrived)/i;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(b.job_id, 10) || 0;
  if (!jobId) return json(400, { ok: false, error: 'job_id required' });

  let job = {}; try { job = (await crud.searchOne(crud.TABLES.jobs, { id: jobId })) || {}; } catch (_) {}
  const cur = String(job.parts_status || '').toLowerCase();
  const eta = String(job.parts_eta_date || '').trim();

  if (b.clear) {
    if (cur === 'to_order') { try { await crud.update(crud.TABLES.jobs, jobId, { parts_status: '' }); } catch (_) {} }
    return json(200, { ok: true, cleared: cur === 'to_order' });
  }

  // Never override a real order (ETA set or an ordered status) — those own the flow.
  if (eta || ORDERED.test(cur)) return json(200, { ok: true, skipped: 'already ordered/has ETA', parts_status: cur });
  try { await crud.update(crud.TABLES.jobs, jobId, { parts_status: 'to_order' }); }
  catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
  try { await crud.logEvent('parts_to_order_flagged', { job_id: jobId, via: 'teddy_tool_prediagnosis', at_ms: Date.now() }); } catch (_) {}
  return json(200, { ok: true, parts_status: 'to_order' });
};
