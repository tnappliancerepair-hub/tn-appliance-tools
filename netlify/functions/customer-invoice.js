// Generates a printable HTML invoice for a customer's completed job.
// Customer prints / saves as PDF via browser. Auth: last4 phone gate
// (same as customer-portal).
//
// URL: /.netlify/functions/customer-invoice?job_id=X&last4=YYYY

const XANO_INTAKE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

exports.handler = async function (event) {
  const p = event.queryStringParameters || {};
  const jobId = Number(p.job_id || 0);
  const last4 = String(p.last4 || '').trim();
  if (!jobId || !last4) return { statusCode: 400, body: 'job_id + last4 required' };

  let view;
  try {
    const r = await fetch(`${XANO_INTAKE}/get_customer_job_view`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ job_id: jobId, phone_last4: last4 }),
    });
    view = await r.json();
  } catch (err) {
    return { statusCode: 500, body: 'fetch failed' };
  }
  if (!view || !view.success) return { statusCode: 401, body: 'unauthorized' };

  const job = view.job || {};
  const cust = view.customer || {};
  const tech = view.tech || {};

  const date = job.job_completed_at ? new Date(Number(job.job_completed_at)).toLocaleDateString() : '—';
  const appl = [job.brand, job.appliance].filter(Boolean).join(' ') || 'appliance';
  const techName = `${tech.first_name || ''} ${tech.last_name || ''}`.trim() || 'TN Appliance';
  const total = job.invoice_amount_cents ? `$${(job.invoice_amount_cents/100).toFixed(2)}` : 'See your texts for payment link';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice - Job #${jobId}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif; max-width: 720px; margin: 40px auto; padding: 24px; color: #1a1f2c; line-height: 1.5; }
  .head { display: flex; justify-content: space-between; align-items: start; border-bottom: 2px solid #ff8a00; padding-bottom: 18px; margin-bottom: 20px; }
  .brand { font-size: 22px; font-weight: 800; }
  .meta { text-align: right; font-size: 12px; color: #666; }
  h1 { font-size: 26px; margin: 18px 0 6px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 18px 0; }
  .grid h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #999; margin-bottom: 6px; }
  .grid p { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
  th { background: #f7f8fb; font-size: 12px; }
  td.amt { text-align: right; font-family: monospace; }
  .total-row { font-weight: 800; font-size: 18px; }
  .footer { margin-top: 30px; padding-top: 18px; border-top: 1px solid #eee; color: #666; font-size: 11px; text-align: center; }
  @media print { .no-print { display: none; } body { margin: 0; padding: 12px; } }
</style></head><body>
<div class="head">
  <div>
    <div class="brand">🐜 TN Appliance Exchange LLC</div>
    <div style="font-size:12px;color:#666;margin-top:4px">Antioch, TN · 866-268-0111</div>
  </div>
  <div class="meta">
    <div>Invoice for Job #${jobId}</div>
    <div>Service date: ${date}</div>
  </div>
</div>

<h1>Service Invoice</h1>

<div class="grid">
  <div>
    <h3>Customer</h3>
    <p><strong>${esc(cust.first_name || '')}</strong></p>
    <p>${esc(cust.phone || '')}</p>
  </div>
  <div>
    <h3>Tech</h3>
    <p>${esc(techName)}</p>
  </div>
</div>

<table>
  <tr><th>Description</th><th style="text-align:right">Amount</th></tr>
  <tr><td>${esc(appl)} repair</td><td class="amt">${esc(total)}</td></tr>
  <tr class="total-row"><td>Total</td><td class="amt">${esc(total)}</td></tr>
</table>

<div class="no-print" style="margin-top:24px;text-align:center">
  <button onclick="window.print()" style="padding:14px 28px;background:#ff8a00;color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer">🖨 Print / Save as PDF</button>
</div>

<div class="footer">
  Thank you for choosing TN Appliance Exchange.<br>
  Questions about this invoice? Call 866-268-0111 or reply to your text thread.<br>
  🐜 Long Live Ant.
</div>
</body></html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  };
};

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
