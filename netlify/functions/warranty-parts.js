// warranty-parts — the "warranty parts being supplied" record for a job. On a warranty
// job the vendor (SquareTrade/Allstate) SUPPLIES the parts (we don't order them), so the
// office needs a place to see/record them — distinct from the "parts we order" flow.
//
// Auto-populates from the RMA tracker (squaretrade-rma-watch → parts_return_label events)
// and supports manual add + status (used / to-return / returned) so nothing slips and we
// dodge chargebacks.
//
//   GET  ?job_id=&claim=                 list supplied parts for the job
//   POST {job_id, claim, part, distributor, status, action:'add'}   record a supplied part
//   POST {job_id, part, status, action:'status'}                    mark used/to_return/returned
'use strict';
const crud = require('./_lib/xano/metadata-crud');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }

function meta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
async function rows(action, n) { try { return await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, n); } catch (_) { return []; } }

// RMA return-description → our status. Unused/Core/DOA must go back; Used stays.
function descStatus(desc) {
  const s = String(desc || '').toLowerCase();
  if (/used/.test(s) && !/unused/.test(s)) return 'used';
  if (/unused|core|doa|return/.test(s)) return 'to_return';
  return 'to_return';
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  if (event.httpMethod === 'POST') {
    let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
    const jobId = Number(b.job_id || 0);
    if (!jobId) return j(400, { ok: false, error: 'job_id required' });
    if (b.action === 'status') {
      if (!b.part) return j(400, { ok: false, error: 'part required' });
      await crud.logEvent('warranty_part_status', { job_id: jobId, part: String(b.part), status: String(b.status || 'returned'), at_ms: Date.now() });
      return j(200, { ok: true });
    }
    // add a manually-recorded supplied part (any vendor — SquareTrade / FrontDoor / NSA)
    if (!b.part) return j(400, { ok: false, error: 'part required' });
    await crud.logEvent('warranty_part_supplied', {
      job_id: jobId, claim: String(b.claim || ''), part: String(b.part),
      distributor: String(b.distributor || ''), vendor: String(b.vendor || ''),
      status: String(b.status || 'to_return'), rma: String(b.rma || ''), tracking: String(b.tracking || ''),
      note: String(b.note || ''), at_ms: Date.now(),
    });
    return j(200, { ok: true });
  }

  const q = event.queryStringParameters || {};
  const jobId = Number(q.job_id || 0);
  const claim = String(q.claim || '');
  if (!jobId && !claim) return j(400, { ok: false, error: 'job_id or claim required' });
  const mine = (m) => (jobId && Number(m.job_id) === jobId) || (claim && String(m.claim) === claim);

  const [labels, manual, statuses] = await Promise.all([rows('parts_return_label', 400), rows('warranty_part_supplied', 200), rows('warranty_part_status', 200)]);

  // latest status override per part
  const override = {};
  for (const r of statuses) { const m = meta(r); if (mine(m) && m.part && override[m.part] == null) override[m.part] = m.status; }

  const byPart = {};
  // from RMA tracker (auto-captured supplied/return parts) — these are SquareTrade/Allstate
  for (const r of labels) { const m = meta(r); if (!mine(m) || !m.part) continue; if (!byPart[m.part]) byPart[m.part] = { part: m.part, distributor: m.distributor || '', vendor: m.vendor || 'SquareTrade', source: 'rma', rma: m.rma || '', tracking: m.tracking || '', return_desc: m.return_desc || '', note: '', status: descStatus(m.return_desc) }; }
  // manually recorded (any vendor)
  for (const r of manual) { const m = meta(r); if (!mine(m) || !m.part) continue; if (!byPart[m.part]) byPart[m.part] = { part: m.part, distributor: m.distributor || '', vendor: m.vendor || '', source: 'manual', rma: m.rma || '', tracking: m.tracking || '', return_desc: '', note: m.note || '', status: m.status || 'to_return' }; }

  const parts = Object.values(byPart).map((p) => ({ ...p, status: override[p.part] || p.status }));
  const to_return = parts.filter((p) => p.status === 'to_return').length;
  return j(200, { ok: true, count: parts.length, to_return, parts });
};
