// Records a business expense (gas / truck fee / other) at any cadence —
// per-job, per-tech, or monthly overhead. Writes an event_log row via the
// Metadata API (no Xano push). expenses-rollup.js reads these back and the
// Money hub P&L nets them against revenue.
//
// POST { category, label?, amount, scope, ref?, note?, date_ms? }
//   category: "gas" | "truck" | "other"
//   scope:    "monthly" | "tech" | "job"
//   ref:      tech_id or job_id when scope is tech/job (optional)

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
    const amount = parseFloat(b.amount);
    const category = String(b.category || 'other').toLowerCase();
    if (isNaN(amount) || amount <= 0) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'amount required' }) };
    }
    const row = {
      action: 'expense_logged',
      metadata: {
        category,
        label: String(b.label || ''),
        amount: amount.toFixed(2),
        scope: String(b.scope || 'monthly').toLowerCase(),
        ref: String(b.ref || ''),
        note: String(b.note || ''),
        expense_date_ms: Number(b.date_ms) || Date.now(),
        logged_by: String(b.logged_by || 'office'),
        logged_at_ms: Date.now(),
      },
    };
    const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
      method: 'POST', headers: headers(), body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return { statusCode: 502, body: JSON.stringify({ success: false, error: 'xano ' + r.status, detail: t.slice(0, 200) }) };
    }
    return { statusCode: 200, body: JSON.stringify({ success: true, category, amount: amount.toFixed(2) }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
