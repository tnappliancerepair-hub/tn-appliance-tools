// Invoice status for the customer portal: is this a self-pay job, how much is
// due, and has it been paid? Drives the "Amount due — Pay now" card.
//
// GET /.netlify/functions/get-invoice-status?job_id=123
// -> { ok, self_pay, amount, paid }
//   self_pay: false for warranty jobs (no payment ever shown)
//   amount:   invoiced total (from the logged invoice)
//   paid:     a customer_payment_received exists for this job

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const JOBS_TABLE = 7;
const EVENT_LOG_TABLE = 3;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function meta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
async function byAction(action) {
  const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ search: { action }, sort: { created_at: 'desc' }, per_page: 500, page: 1 }),
  });
  if (!r.ok) return [];
  const d = await r.json();
  return (d && d.items) || [];
}
function jsonResp(code, body) { return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const jobId = parseInt((event.queryStringParameters || {}).job_id, 10) || 0;
  if (!jobId) return jsonResp(400, { ok: false, error: 'job_id required' });
  try {
    // self-pay?
    let selfPay = false;
    try {
      const jr = await fetch(`${META}/table/${JOBS_TABLE}/content/${jobId}`, { headers: headers() });
      if (jr.ok) {
        const job = await jr.json();
        const ct = String((job && job.customer_type) || '').toLowerCase();
        selfPay = ct === 'self_pay' || ct === 'cash' || ct === 'customer_pay';
      }
    } catch (_) {}
    if (!selfPay) return jsonResp(200, { ok: true, self_pay: false, amount: 0, paid: false });

    // amount due (latest logged invoice for this job)
    const inv = (await byAction('office_invoice_logged')).filter((r) => String(meta(r).job_id) === String(jobId));
    const amount = inv.length ? num(meta(inv[0]).amount_invoiced) : 0;

    // paid? (any customer_payment_received for this job, kind invoice)
    const pays = (await byAction('customer_payment_received')).filter((r) => {
      const m = meta(r); return String(m.job_id) === String(jobId) && (m.kind || 'invoice') === 'invoice';
    });
    const paid = pays.length > 0;

    return jsonResp(200, { ok: true, self_pay: true, amount: Number(amount.toFixed(2)), paid });
  } catch (err) {
    return jsonResp(200, { ok: false, error: err.message, self_pay: false, amount: 0, paid: false });
  }
};
