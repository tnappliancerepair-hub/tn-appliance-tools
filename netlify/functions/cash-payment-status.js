// cash-payment-status — given a list of job ids, return which have been PAID.
// Used by the scheduling board to HOLD unpaid CASH jobs out of "ready to schedule"
// until the customer pays. Reads the authoritative job-row payment_status +
// payment_collected, and backstops with quick_check_paid / customer_payment_received
// events. Caller decides cash-vs-warranty — this only reports paid/unpaid.
//
//   POST { ids: [..] } -> { ok, paid: { "<id>": true|false }, types: { "<id>": "<customer_type>" } }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const JOBS = 7;
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => parseInt(x, 10)).filter(Boolean).slice(0, 80);
  if (!ids.length) return j(200, { ok: true, paid: {}, types: {} });

  const paid = {}, types = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const row = await crud.searchOne(JOBS, { id });
      if (!row) { types[id] = ''; paid[id] = false; return; }
      types[id] = String(row.customer_type || '').toLowerCase();
      const ps = String(row.payment_status || '').toLowerCase();
      paid[id] = ps === 'paid' || row.payment_collected === true;
    } catch (_) { types[id] = ''; paid[id] = false; }
  }));

  // Backstop: any job with a recorded cash payment event counts as paid, even if
  // the row flag lagged. Single scan over recent payment events.
  try {
    const want = new Set(ids.filter((id) => !paid[id]).map(Number));
    if (want.size) {
      const [qc, cp] = await Promise.all([
        crud.searchPage(crud.TABLES.event_log, { action: 'quick_check_paid' }, { id: 'desc' }, 400),
        crud.searchPage(crud.TABLES.event_log, { action: 'customer_payment_received' }, { id: 'desc' }, 400),
      ]);
      for (const r of [...qc, ...cp]) {
        const m = meta(r); const jid = Number(m.job_id);
        if (want.has(jid)) paid[jid] = true;
      }
    }
  } catch (_) {}

  return j(200, { ok: true, paid, types });
};
