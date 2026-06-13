// Records a customer add-on request from the portal ($10-off offers — supply
// lines, water filter, coil/vent kits, etc.). Writes an event_log row so the
// office gets it and ships the item with the job's parts order. No Xano push.
//
// POST { job_id, addon_key, name, price, discount?, source? }

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;
const JOBS_TABLE = 7;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

// On fulfillment we want the add-on's tech cut to land on whoever's job it is.
// Look up the job's assigned tech so the credit is attributed correctly.
async function lookupJobTech(jobId) {
  try {
    const r = await fetch(`${META}/table/${JOBS_TABLE}/content/${jobId}`, { headers: headers() });
    if (!r.ok) return 0;
    const j = await r.json();
    return parseInt(j && j.technician_id, 10) || 0;
  } catch (_) { return 0; }
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const b = JSON.parse(event.body || '{}');
    const job_id = parseInt(b.job_id, 10);
    const addon_key = String(b.addon_key || '').trim();
    if (!job_id || !addon_key) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'job_id and addon_key required' }) };
    }
    const price = parseFloat(b.price) || 0;
    const discount = parseFloat(b.discount) || 0;
    const tech_cut = parseFloat(b.tech_cut) || 0;
    const cost = parseFloat(b.cost) || 0; // our part cost (for P&L margin)
    const mode = String(b.mode || 'installed'); // installed | ship | inquire
    const status = String(b.status || 'requested');
    // Credit the tech only at fulfillment. Prefer an explicit technician_id from
    // the caller (office board knows it), else resolve from the job record.
    let technician_id = parseInt(b.technician_id, 10) || 0;
    if (status === 'fulfilled' && !technician_id) technician_id = await lookupJobTech(job_id);
    const row = {
      action: status === 'fulfilled' ? 'addon_fulfilled' : 'addon_requested',
      metadata: {
        job_id,
        addon_key,
        name: String(b.name || addon_key),
        price: price.toFixed(2),
        discount: discount.toFixed(2),
        net_price: Math.max(0, price - discount).toFixed(2),
        tech_cut: tech_cut.toFixed(2),
        cost: cost.toFixed(2),
        technician_id: technician_id || null,
        mode: mode,
        status: status,
        source: String(b.source || 'customer_portal'),
        requested_at_ms: Date.now(),
      },
    };
    const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
      method: 'POST', headers: headers(), body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return { statusCode: 502, body: JSON.stringify({ success: false, error: 'xano ' + r.status, detail: t.slice(0, 160) }) };
    }
    return { statusCode: 200, body: JSON.stringify({ success: true, addon_key, net_price: Math.max(0, price - discount).toFixed(2) }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
