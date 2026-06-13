// Records a tech payout (the office "Mark paid" action). Writes an event_log
// row action="tech_payout_recorded"; tech-earnings.js subtracts these from
// earned, so the tech's "Owed" balance drops the moment it's recorded.
//
// POST { technician_id, amount, period?, note? }

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const b = JSON.parse(event.body || '{}');
    const technician_id = parseInt(b.technician_id, 10);
    const amount = parseFloat(b.amount);
    if (!technician_id || isNaN(amount)) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'technician_id and amount required' }) };
    }
    const row = {
      action: 'tech_payout_recorded',
      metadata: {
        technician_id,
        amount: amount.toFixed(2),
        job_id: String(b.job_id || ''),
        period: String(b.period || ''),
        note: String(b.note || ''),
        paid_at_ms: Date.now(),
        recorded_by: String(b.recorded_by || 'office'),
      },
    };
    const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
      method: 'POST', headers: headers(), body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return { statusCode: 502, body: JSON.stringify({ success: false, error: 'xano ' + r.status, detail: t.slice(0, 200) }) };
    }
    return { statusCode: 200, body: JSON.stringify({ success: true, technician_id, amount: amount.toFixed(2) }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
