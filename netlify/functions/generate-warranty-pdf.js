// Generates a warranty-claim PDF for AHS / Frontdoor / Choice from job +
// TDR + customer data. Uses pdfkit (operator must install in netlify
// dependencies).
//
// For now, returns HTML that can be rendered to PDF by Danielle's
// browser (Cmd-P → Save as PDF) until real PDF lib is wired.

const VENDOR_TEMPLATES = {
  ahs: { name: 'American Home Shield', address: '' },
  frontdoor: { name: 'Frontdoor', address: '' },
  choice: { name: 'Choice Home Warranty', address: '' },
  squaretrade: { name: 'SquareTrade', address: '' },
};

const XANO_INTAKE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const jobId = Number(params.job_id || 0);
  const vendor = String(params.vendor || 'ahs').toLowerCase();

  if (!jobId) {
    return { statusCode: 400, body: 'job_id required' };
  }

  // Pull job context
  let job = null, customer = null, tech = null, tdr = null;
  try {
    const jobRes = await fetch(`${XANO_INTAKE}/get_job?job_id=${jobId}`);
    job = await jobRes.json();
    if (job && job.customer_id) {
      const cRes = await fetch(`${XANO_INTAKE}/get_customer?customer_id=${job.customer_id}`);
      customer = await cRes.json();
    }
  } catch (err) {
    return { statusCode: 500, body: 'Xano fetch failed: ' + err.message };
  }

  if (!job || !job.id) {
    return { statusCode: 404, body: 'Job not found' };
  }

  const vt = VENDOR_TEMPLATES[vendor] || { name: vendor.toUpperCase(), address: '' };

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Warranty Claim - Job #${jobId}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 720px; margin: 40px auto; padding: 24px; line-height: 1.5; }
  h1 { margin-bottom: 8px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
  .section { margin-bottom: 18px; padding: 12px; border: 1px solid #ddd; border-radius: 6px; }
  .section h2 { font-size: 14px; text-transform: uppercase; margin-bottom: 8px; color: #444; }
  .row { display: flex; gap: 16px; margin-bottom: 4px; }
  .row .label { min-width: 140px; color: #666; font-size: 13px; }
  .row .value { font-size: 14px; }
  @media print { body { margin: 0; } .no-print { display: none; } }
</style></head>
<body>
  <h1>Warranty Claim Submission</h1>
  <div class="meta">Vendor: <strong>${vt.name}</strong> · Job #${jobId} · Generated ${new Date().toISOString().slice(0, 10)}</div>

  <div class="section">
    <h2>Customer</h2>
    <div class="row"><div class="label">Name</div><div class="value">${esc(customer?.first_name)} ${esc(customer?.last_name)}</div></div>
    <div class="row"><div class="label">Phone</div><div class="value">${esc(customer?.phone)}</div></div>
    <div class="row"><div class="label">Address</div><div class="value">${esc(customer?.address)}, ${esc(customer?.city)}, ${esc(customer?.state)} ${esc(customer?.zip)}</div></div>
  </div>

  <div class="section">
    <h2>Job</h2>
    <div class="row"><div class="label">Appliance</div><div class="value">${esc(job.brand)} ${esc(job.appliance_type)}</div></div>
    <div class="row"><div class="label">Model</div><div class="value">${esc(job.model_number)}</div></div>
    <div class="row"><div class="label">Claim Number</div><div class="value">${esc(job.claim_number)}</div></div>
    <div class="row"><div class="label">Service Date</div><div class="value">${job.scheduled_start ? new Date(Number(job.scheduled_start)).toLocaleDateString() : 'n/a'}</div></div>
  </div>

  <div class="section">
    <h2>Diagnosis + Repair</h2>
    <div class="row"><div class="label">Problem</div><div class="value">${esc(job.problem_summary)}</div></div>
    <div class="row"><div class="label">Failure</div><div class="value">[Fill from TDR]</div></div>
    <div class="row"><div class="label">Failed Component</div><div class="value">[Fill from TDR]</div></div>
    <div class="row"><div class="label">Repair</div><div class="value">[Fill from TDR]</div></div>
    <div class="row"><div class="label">Labor Hours</div><div class="value">[Fill from TDR]</div></div>
  </div>

  <div class="section">
    <h2>Vendor Routing</h2>
    <div class="row"><div class="label">Submit to</div><div class="value">${esc(vt.name)} portal</div></div>
    <div class="row"><div class="label">Notes</div><div class="value">Danielle: review and submit via vendor web portal.</div></div>
  </div>

  <div class="no-print" style="margin-top: 30px; text-align: center;">
    <button onclick="window.print()" style="padding:12px 24px;background:#ff8a00;color:white;border:none;border-radius:6px;font-weight:700;cursor:pointer">🖨 Print / Save as PDF</button>
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
