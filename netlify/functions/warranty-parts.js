// warranty-parts — the "warranty parts being supplied" record for a job. On a warranty
// job the vendor (SquareTrade/Allstate/AHS) SUPPLIES the parts (we don't order them), so
// the office + tech need a place to see/record them — distinct from the "parts we order".
//
// Auto-populates from the RMA tracker (squaretrade-rma-watch → parts_return_label events)
// AND the email watchers (servicepower-parts-watch → warranty_part_supplied), then the
// tech confirms each one with THREE clean options — Used / Unused / Missing — and the
// office sees those checks auto-reflected (with a manual override of its own).
//
//   GET  ?job_id=&claim=                              list supplied parts for the job
//   POST {job_id, claim, part, ..., action:'add'}     record a supplied part
//   POST {job_id, part, status, by, action:'status'}  check it: used | unused | missing
//                                                      (also accepts to_return / returned)
//   POST {job_id, part, action:'discrepancy'}         legacy "not here" flag (= missing)
//
// Status vocabulary (what GET returns + UI shows):
//   used      — installed/consumed on the job, no return needed
//   to_return — UNUSED, must go back to the warranty company (the chargeback risk)
//   missing   — never arrived / no old part to return (timestamped shield)
//   returned  — office confirmed it shipped back (terminal, clears the worklist)
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

// Normalize an incoming check word to our status vocabulary.
function normStatus(s) {
  const x = String(s || '').toLowerCase().trim();
  if (x === 'used') return 'used';
  if (x === 'unused' || x === 'to_return' || x === 'return') return 'to_return';
  if (x === 'missing' || x === 'not_here' || x === 'not-here' || x === 'discrepancy') return 'missing';
  if (x === 'returned' || x === 'shipped') return 'returned';
  // requested = we've asked the warranty co to ship this part; awaiting their ETA.
  if (x === 'requested' || x === 'ordered' || x === 'request') return 'requested';
  return 'to_return';
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  if (event.httpMethod === 'POST') {
    let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
    const jobId = Number(b.job_id || 0);
    if (!jobId) return j(400, { ok: false, error: 'job_id required' });

    // The tech/office checks a part: used | unused | missing (or to_return/returned).
    if (b.action === 'status') {
      if (!b.part) return j(400, { ok: false, error: 'part required' });
      const status = normStatus(b.status);
      const by = String(b.by || '').toLowerCase() === 'office' ? 'office' : (String(b.by || '').toLowerCase() === 'tech' ? 'tech' : '');
      await crud.logEvent('warranty_part_status', {
        job_id: jobId, part: String(b.part), status, by,
        technician_id: Number(b.technician_id || 0) || null, at_ms: Date.now(),
      });
      // "missing" ALSO drops the timestamped discrepancy record (the chargeback shield).
      if (status === 'missing') {
        await crud.logEvent('warranty_part_discrepancy', {
          job_id: jobId, part: String(b.part), technician_id: Number(b.technician_id || 0) || null,
          reason: String(b.reason || b.note || 'marked missing'), by, at_ms: Date.now(),
        });
      }
      return j(200, { ok: true, status });
    }
    // The tech snaps a photo of a part (proof of used / to-return). The image is already
    // in S3 (via /photo-upload) — we just link its s3_key to the part + status here so it
    // shows as a thumbnail on the part row. Warranty documentation + chargeback shield.
    if (b.action === 'photo') {
      if (!b.part || !b.s3_key) return j(400, { ok: false, error: 'part and s3_key required' });
      await crud.logEvent('warranty_part_photo', {
        job_id: jobId, part: String(b.part), s3_key: String(b.s3_key),
        status: normStatus(b.status), technician_id: Number(b.technician_id || 0) || null,
        by: String(b.by || 'tech'), at_ms: Date.now(),
      });
      return j(200, { ok: true, s3_key: String(b.s3_key) });
    }
    // Legacy "not here" flag (tech) — same as marking missing.
    if (b.action === 'discrepancy') {
      await crud.logEvent('warranty_part_discrepancy', {
        job_id: jobId, part: String(b.part || ''), technician_id: Number(b.technician_id || 0) || null,
        reason: String(b.reason || b.note || 'not present'), by: 'tech', at_ms: Date.now(),
      });
      await crud.logEvent('warranty_part_status', {
        job_id: jobId, part: String(b.part || ''), status: 'missing', by: 'tech',
        technician_id: Number(b.technician_id || 0) || null, at_ms: Date.now(),
      });
      return j(200, { ok: true });
    }
    // add a manually-recorded supplied part (any vendor — SquareTrade / FrontDoor / NSA)
    if (!b.part) return j(400, { ok: false, error: 'part required' });
    await crud.logEvent('warranty_part_supplied', {
      job_id: jobId, claim: String(b.claim || ''), part: String(b.part),
      description: String(b.description || b.desc || ''),
      distributor: String(b.distributor || ''), vendor: String(b.vendor || ''),
      source: String(b.source || 'manual'),
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

  const [labels, manual, statuses, discreps, photos] = await Promise.all([
    rows('parts_return_label', 400), rows('warranty_part_supplied', 200),
    rows('warranty_part_status', 300), rows('warranty_part_discrepancy', 200),
    rows('warranty_part_photo', 300),
  ]);

  // photos per part — newest first. The card resolves each s3_key to a signed thumbnail.
  const photoByPart = {};
  for (const r of photos) {
    const m = meta(r); if (!mine(m) || !m.part || !m.s3_key) continue;
    (photoByPart[m.part] = photoByPart[m.part] || []).push({ s3_key: String(m.s3_key), status: String(m.status || ''), at: Number(m.at_ms) || 0, by: String(m.by || '') });
  }
  for (const k of Object.keys(photoByPart)) photoByPart[k].sort((a, b) => b.at - a.at);

  // Latest explicit DECISION per part — the tech (or office) check. Compared across
  // both status events and discrepancy events by timestamp so the newest wins. This
  // is what makes a part "checked" vs still-needing-attention.
  const decision = {}; // part -> { status, by, at }
  const consider = (part, status, by, at) => {
    if (!part) return;
    const cur = decision[part];
    if (!cur || at >= cur.at) decision[part] = { status, by: by || (cur && cur.by) || '', at };
  };
  for (const r of statuses) { const m = meta(r); if (!mine(m) || !m.part) continue; consider(m.part, normStatus(m.status), m.by || '', Number(m.at_ms) || 0); }
  for (const r of discreps) { const m = meta(r); if (!mine(m) || !m.part) continue; consider(m.part, 'missing', m.by || 'tech', Number(m.at_ms) || 0); }

  const byPart = {};
  // from RMA tracker (auto-captured supplied/return parts) — SquareTrade/Allstate
  for (const r of labels) { const m = meta(r); if (!mine(m) || !m.part) continue; if (!byPart[m.part]) byPart[m.part] = { part: m.part, description: m.description || '', distributor: m.distributor || '', vendor: m.vendor || 'SquareTrade', source: 'rma', rma: m.rma || '', tracking: m.tracking || '', return_desc: m.return_desc || '', note: '', status: descStatus(m.return_desc) }; }
  // from email watchers + manual add (any vendor)
  for (const r of manual) { const m = meta(r); if (!mine(m) || !m.part) continue; if (!byPart[m.part]) byPart[m.part] = { part: m.part, description: m.description || '', distributor: m.distributor || '', vendor: m.vendor || '', source: m.source || 'manual', rma: m.rma || '', tracking: m.tracking || '', return_desc: '', note: m.note || '', status: m.status || 'to_return' }; }

  const parts = Object.values(byPart).map((p) => {
    const d = decision[p.part];
    return {
      ...p,
      status: d ? d.status : p.status,   // explicit check wins over the supply default
      checked: !!d,                       // has the tech/office confirmed this one?
      checked_by: d ? d.by : '',          // 'tech' | 'office' | ''
      checked_at: d ? d.at : 0,
      photos: photoByPart[p.part] || [],  // [{s3_key, status, at, by}] newest first
    };
  });
  const to_return = parts.filter((p) => p.status === 'to_return').length;
  const missing = parts.filter((p) => p.status === 'missing').length;
  const unchecked = parts.filter((p) => !p.checked).length;
  return j(200, { ok: true, count: parts.length, to_return, missing, unchecked, parts });
};
