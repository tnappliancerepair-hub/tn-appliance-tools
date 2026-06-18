// Pulls the live Profit & Loss from Digits' AI ledger for the Money hub "Books"
// tab. Income + expense categories come straight from Digits (which already
// tracks the cards/bills); once Ant pushes income in too, this is the complete
// owner P&L.
//
// GET /.netlify/functions/digits-pnl?start=YYYY-MM-DD&end=YYYY-MM-DD&interval=Month
// -> { success, configured, rows:[{label,kind,amount,code}] }  (amount in $)

'use strict';

const { isConnected, getAccessToken, apiGet } = require('./_lib/digits');

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (!(await isConnected())) {
    return { statusCode: 200, body: JSON.stringify({ success: false, configured: false, error: 'Digits not connected yet' }) };
  }
  const q = event.queryStringParameters || {};
  const qs = new URLSearchParams();
  if (q.start) qs.set('startDate', q.start);
  if (q.end) qs.set('endDate', q.end);
  qs.set('interval', q.interval || 'Month');

  try {
    const token = await getAccessToken();
    const d = await apiGet('/ledger/statement/profit-and-loss?' + qs.toString(), token);
    const rows = (d.rows || []).map((r) => ({
      label: r.label || '',
      kind: (r.summary && r.summary.kind) || '',
      amount: ((r.total && r.total.amount) || 0) / 100,
      code: (r.total && r.total.code) || 'USD',
    }));
    return { statusCode: 200, body: JSON.stringify({ success: true, configured: true, rows }) };
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ success: false, configured: true, error: err.message }) };
  }
};
