// list-invoices — the office Invoices list (replaces what HCP did). Aggregates
// every logged invoice (office_invoice_logged) with the customer, the job, and
// the PAID/UNPAID status (from real payment records), newest first. Backs
// invoices.html so Danielle can SEE all invoices in one place. (HCP cutover,
// 2026-06-30: "I need to get invoices figured out... still can't see it.")
//
//   GET ?days=90   -> { ok, count, invoices:[{ job_id, customer, phone, amount,
//                       labor, parts, tax, type, paid, method, when_ms, logged_by }] }
'use strict';
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
const ms = (x) => x ? new Date(x).getTime() : 0;

// The metadata content/search endpoint is intermittent ("fetch failed" under
// load) — retry once before giving up so the list doesn't silently come back empty.
async function metaSearch(tableId, body) {
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch(`${META}/table/${tableId}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      if (!r.ok) { if (a === 0) continue; return []; }
      return ((await r.json()).items) || [];
    } catch (_) { if (a === 0) continue; return []; }
  }
  return [];
}
async function searchAction(tableId, action, perPage) {
  return metaSearch(tableId, { search: { action }, per_page: Math.min(perPage || 400, 500), page: 1, sort: { id: 'desc' } });
}
async function listPage(tableId, perPage, page) {
  return metaSearch(tableId, { per_page: Math.min(perPage, 500), page: page || 1, sort: { id: 'desc' } });
}
// Resolve customer + jobs tables by field shape (ids conflict across the repo).
let _ids = null;
async function resolveIds() {
  if (_ids) return _ids;
  let customer = null, jobs = null;
  for (const id of [6, 5, 7, 1, 2, 8, 9, 10, 14, 16, 3, 4]) {
    if (customer && jobs) break;
    let row;
    try { const r = await fetch(`${META}/table/${id}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ per_page: 1, page: 1 }) }); if (!r.ok) continue; row = ((await r.json()).items || [])[0]; } catch (_) { continue; }
    if (!row) continue;
    const k = Object.keys(row);
    if (!customer && k.includes('first_name') && k.includes('last_name') && k.includes('phone') && !k.includes('conversation_id') && !k.includes('customer_id')) customer = id;
    if (!jobs && k.includes('customer_id') && (k.includes('scheduling_status') || k.includes('appliance_type'))) jobs = id;
  }
  _ids = { customer, jobs }; return _ids;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(200, { ok: true });
  const q = event.queryStringParameters || {};
  const days = Math.max(1, Math.min(365, parseInt(q.days, 10) || 90));
  const cutoff = Date.now() - days * 86400000;
  const EVENT = 3;

  let ids;
  try { ids = await resolveIds(); } catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }
  if (!ids.jobs) return j(200, { ok: false, error: 'could not resolve jobs table' });

  // Invoices + payment records (by action — single-field search is reliable).
  let invRows = [], payRows = [], qcRows = [], markRows = [], unmarkRows = [];
  try {
    [invRows, payRows, qcRows, markRows, unmarkRows] = await Promise.all([
      searchAction(EVENT, 'office_invoice_logged', 600),
      searchAction(EVENT, 'customer_payment_received', 600),
      searchAction(EVENT, 'quick_check_paid', 400),
      searchAction(EVENT, 'invoice_marked_paid', 600),
      searchAction(EVENT, 'invoice_marked_unpaid', 400),
    ]);
  } catch (e) { return j(200, { ok: false, error: 'events: ' + String(e.message || e) }); }
  if (q.debug === '1') return j(200, { ok: true, debug: true, inv_rows: invRows.length, pay_rows: payRows.length, qc_rows: qcRows.length, mark_rows: markRows.length, sample_inv: invRows.slice(0, 2).map(meta) });

  // Paid set: any job with a payment record.
  const paidBy = {};
  for (const r of [...payRows, ...qcRows]) { const m = meta(r); const jid = Number(m.job_id || 0); if (jid) paidBy[jid] = paidBy[jid] || { method: m.pay_method || m.method || (r.action === 'quick_check_paid' ? 'quick check' : 'card'), at: ms(m.logged_at_ms || m.at_ms || r.created_at) }; }

  // MANUAL override (Danielle marks paid/unpaid — from the board's Paid folder or
  // the invoices page). Latest write per job WINS over auto-detection, and it's
  // the only way warranty jobs (paid by vendor EFT) ever read as Paid.
  const manual = {}; // job_id -> { paid, at, method }
  for (const r of [...markRows, ...unmarkRows]) {
    const m = meta(r); const jid = Number(m.job_id || 0); if (!jid) continue;
    const at = ms(m.at_ms || r.created_at);
    const isPaid = r.action === 'invoice_marked_paid';
    if (!manual[jid] || at >= manual[jid].at) manual[jid] = { paid: isPaid, at, method: m.method || 'office' };
  }

  // Latest invoice per job within the window.
  const seen = new Set(); const invoices = [];
  for (const r of invRows) {
    const m = meta(r);
    const jid = Number(m.job_id || 0);
    if (!jid || seen.has(jid)) continue;
    const at = ms(m.logged_at_ms || m.at_ms || r.created_at);
    if (at && at < cutoff) continue;
    seen.add(jid);
    invoices.push({ job_id: jid, amount: num(m.amount_invoiced), labor: num(m.labor), parts: num(m.parts_charge || m.parts), tax: num(m.tax), tech_id: Number(m.technician_id || 0), logged_by: m.logged_by || '', when_ms: at });
  }
  if (!invoices.length) return j(200, { ok: true, count: 0, invoices: [] });

  // Join job → customer + type. Pull recent jobs + customers, map by id.
  const jobMap = {}; const custMap = {};
  try { for (let pg = 1; pg <= 4; pg++) { const rows = await listPage(ids.jobs, 400, pg); for (const jb of rows) jobMap[jb.id] = jb; if (rows.length < 400) break; } } catch (_) {}
  if (ids.customer) { try { for (let pg = 1; pg <= 5; pg++) { const rows = await listPage(ids.customer, 500, pg); for (const c of rows) custMap[c.id] = c; if (rows.length < 500) break; } } catch (_) {} }

  for (const inv of invoices) {
    const jb = jobMap[inv.job_id] || {};
    const c = custMap[jb.customer_id] || {};
    inv.customer = ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || 'Customer';
    inv.phone = String(c.phone || '').replace(/\D/g, '').slice(-10);
    inv.type = jb.customer_type || '';
    inv.appliance = [jb.brand, jb.appliance_type].filter(Boolean).join(' ');
    inv.claim = jb.claim_number || '';
    const mo = manual[inv.job_id];
    const p = paidBy[inv.job_id];
    if (mo) { inv.paid = mo.paid; inv.method = mo.paid ? 'marked paid' : ''; inv.marked = true; }
    else { inv.paid = !!p; inv.method = p ? p.method : ''; inv.marked = false; }
    inv.warranty = inv.type === 'warranty';
  }
  invoices.sort((a, b) => b.when_ms - a.when_ms);
  const unpaid = invoices.filter((i) => !i.paid && !i.warranty && i.amount > 0).length;
  return j(200, { ok: true, count: invoices.length, unpaid, invoices });
};
