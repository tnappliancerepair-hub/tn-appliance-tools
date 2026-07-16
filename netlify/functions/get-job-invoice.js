// get-job-invoice — read back the LAST invoice the office logged for one job,
// straight from the durable server record (event_log action=office_invoice_logged
// written by record_job_invoice). The office-board worksheet used to read only
// from the browser's localStorage, so a saved invoice looked EMPTY on any other
// device — or after iOS Safari evicted localStorage (Danielle, payroll night
// 2026-07-16: "half my invoice sections were empty even though I filled them out
// and saved"). Hydrating from this makes the board the durable source of truth.
//
//   GET ?job_id=20436  -> { ok, found, when_ms, invoice:{ labor, partcost, parts,
//                           ship, tax, tip, techpay, amount_invoiced, technician_id } }
'use strict';

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const EVENT = 3;
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

async function metaSearch(body) {
  for (let a = 0; a < 2; a++) {
    try { const r = await fetch(`${META}/table/${EVENT}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }); if (!r.ok) { if (a === 0) continue; return []; } return ((await r.json()).items) || []; }
    catch (_) { if (a === 0) continue; return []; }
  }
  return [];
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(200, { ok: true });
  const jobId = parseInt((event.queryStringParameters || {}).job_id, 10);
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });

  // Newest office_invoice_logged for THIS job. Search is single-field (action), so
  // scan newest-first pages and take the first row whose job_id matches.
  let hit = null, hitWhen = 0;
  try {
    for (let p = 1; p <= 4 && !hit; p++) {
      const rows = await metaSearch({ search: { action: 'office_invoice_logged' }, sort: { created_at: 'desc' }, per_page: 500, page: p });
      for (const r of rows) {
        const m = metaOf(r);
        if (parseInt(m.job_id, 10) !== jobId) continue;
        hit = m; hitWhen = Number(m.logged_at_ms) || (r.created_at ? Date.parse(r.created_at) : 0); break;
      }
      if (rows.length < 500) break;
    }
  } catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }

  if (!hit) return j(200, { ok: true, found: false, job_id: jobId });
  const s = (v) => (v == null ? '' : String(v));
  return j(200, {
    ok: true, found: true, job_id: jobId, when_ms: hitWhen,
    invoice: {
      labor: s(hit.labor), partcost: s(hit.part_cost), parts: s(hit.parts_charge),
      ship: s(hit.shipping), tax: s(hit.tax), tip: s(hit.tip), techpay: s(hit.tech_pay),
      amount_invoiced: s(hit.amount_invoiced), technician_id: Number(hit.technician_id || 0),
    },
  });
};
