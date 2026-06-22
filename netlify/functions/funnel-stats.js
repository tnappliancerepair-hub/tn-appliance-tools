// funnel-stats — token-gated read of the web conversion funnel. Counts unique
// visitors (conv_id) that reached each step over the window, so you see the
// drop-off: opened -> started -> reached checkout -> paid.
//   GET ?key=tn-funnel-2026&days=14
'use strict';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const GUARD = 'tn-funnel-2026';
function j(b) { return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if ((q.key || '') !== GUARD) return { statusCode: 401, body: 'unauthorized' };
  const days = parseInt(q.days || '14', 10);
  let items = [];
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=web_funnel&days_back=${days}&limit=2000`, { signal: AbortSignal.timeout(12000) });
    const d = await r.json(); items = d.items || [];
  } catch (e) { return j({ ok: false, error: String(e.message || e) }); }
  const byStep = { open: new Set(), started: new Set(), reached_pay: new Set(), paid: new Set() };
  items.forEach((it) => {
    let m = it.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    const step = m && m.step, cid = (m && m.conv_id) || ('row' + it.id);
    if (byStep[step]) byStep[step].add(cid);
  });
  const open = byStep.open.size, started = byStep.started.size, pay = byStep.reached_pay.size, paid = byStep.paid.size;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  return j({ ok: true, days, funnel: { opened: open, started, reached_checkout: pay, paid, started_rate_pct: pct(started, open), checkout_rate_pct: pct(pay, started), paid_rate_pct: pct(paid, pay), overall_conversion_pct: pct(paid, open) } });
};
