// warranty-dashboard — data for the Warranty command center (warranty-review.html).
// Two things Danielle needs in one place:
//   1) CLAIMS money — paid / approved-pending / rejected (from the claims reconcile poller's
//      sp_claim_sync_state snapshot).
//   2) PARTS OWED BACK — every part still to-return across all jobs (the chargeback list),
//      from the RMA tracker + manual warranty parts, oldest first.
//
//   GET  → { ok, claims:{paid_total, by_status, rejected:[...]}, returns:{count, parts:[...]} }
'use strict';
const crud = require('./_lib/xano/metadata-crud');

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
async function rows(action, n) { try { return await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, n); } catch (_) { return []; } }
const STATUS_NAME = { D: 'Dtr Review', F: 'Forwarded', I: 'Incomplete', K: 'FSS Review', M: 'Mfg Review', P: 'Paid', R: 'Rejected', S: 'Approved', W: 'Mfg-Reject' };
const TERMINAL = new Set(['P', 'R', 'W']);
function descStatus(desc) { const s = String(desc || '').toLowerCase(); if (/used/.test(s) && !/unused/.test(s)) return 'used'; return 'to_return'; }

exports.handler = async function (event) {
  // ---- CLAIMS rollup (latest reconcile snapshot) ----
  let claims = { paid_total: 0, by_status: {}, rejected: [], pending_count: 0 };
  try {
    const snap = await crud.searchOne(crud.TABLES.event_log, { action: 'sp_claim_sync_state' }, { id: 'desc' });
    const m = meta(snap); const map = (m && m.map) || {};
    for (const call of Object.keys(map)) {
      const s = map[call].status || '?';
      claims.by_status[s] = (claims.by_status[s] || 0) + 1;
      if (s === 'P') claims.paid_total += Number(map[call].paid_total || 0);
      else if (!TERMINAL.has(s)) claims.pending_count++;
      if (s === 'R' || s === 'W') claims.rejected.push({ call, status: STATUS_NAME[s] || s });
    }
    claims.paid_total = Math.round(claims.paid_total * 100) / 100;
  } catch (_) {}

  // ---- PARTS owed back (the chargeback worklist) ----
  const [labels, manual, statuses] = await Promise.all([rows('parts_return_label', 500), rows('warranty_part_supplied', 300), rows('warranty_part_status', 300)]);
  const override = {};
  for (const r of statuses) { const mm = meta(r); const key = `${mm.job_id}|${mm.part}`; if (mm.part && override[key] == null) override[key] = mm.status; }
  const byKey = {};
  const add = (mm, src) => {
    if (!mm.part) return; const key = `${mm.job_id}|${mm.part}`;
    if (byKey[key]) return;
    byKey[key] = {
      part: mm.part, distributor: mm.distributor || '', vendor: mm.vendor || (src === 'rma' ? 'SquareTrade' : ''),
      customer: mm.customer || '', claim: mm.claim || '', job_id: mm.job_id || null,
      rma: mm.rma || '', tracking: mm.tracking || '', return_desc: mm.return_desc || '',
      at_ms: Number(mm.at_ms || 0), status: src === 'rma' ? descStatus(mm.return_desc) : (mm.status || 'to_return'),
    };
  };
  for (const r of labels) add(meta(r), 'rma');
  for (const r of manual) add(meta(r), 'manual');

  const now = Date.now();
  let parts = Object.entries(byKey).map(([key, p]) => ({ ...p, status: override[key] || p.status }));
  parts = parts.filter((p) => p.status === 'to_return')
    .map((p) => ({ ...p, age_days: p.at_ms ? Math.floor((now - p.at_ms) / 86400000) : null }))
    .sort((a, b) => (a.at_ms || 0) - (b.at_ms || 0));   // oldest first = most urgent

  return j(200, { ok: true, claims, returns: { count: parts.length, parts } });
};
