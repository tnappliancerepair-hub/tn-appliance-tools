// cash-pipeline — owner's live view of the $50 Quick Check money machine.
// Reads the event_log breadcrumbs we emit across the self-checkout flow and
// rolls them into a funnel + action list. Read-only, no side effects.
//
//   GET ?days=7  -> { ok, window_days, quick_checks:{...}, parts:{...},
//                     action_needed:{...}, recent:[...] }

'use strict';
const crud = require('./_lib/xano/metadata-crud');
const EVENT_LOG = 3, PARTS_ORDERS = 47;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function rowMs(r) { const m = meta(r); return m.at_ms || (r.created_at ? new Date(r.created_at).getTime() : 0); }

exports.handler = async function (event) {
  const days = Math.min(Math.max(parseInt((event.queryStringParameters || {}).days, 10) || 7, 1), 60);
  const since = Date.now() - days * 86400000;
  const startOfTodayCT = (() => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return new Date(p + 'T00:00:00-05:00').getTime();
  })();

  async function pull(action, n) { try { return (await crud.searchPage(EVENT_LOG, { action }, { created_at: 'desc' }, n || 300)) || []; } catch (_) { return []; } }

  const [paid, mediaPending, ordersCreated, ordersPlaced] = await Promise.all([
    pull('quick_check_paid'), pull('quick_check_media_pending'), pull('parts_order_created'), pull('parts_order_placed'),
  ]);

  const inWin = (rows) => rows.filter((r) => rowMs(r) >= since);
  const paidWin = inWin(paid);
  const paidToday = paidWin.filter((r) => rowMs(r) >= startOfTodayCT);
  const sum = (rows) => rows.reduce((a, r) => a + (Number(meta(r).amount) || 0), 0);

  // parts orders still sitting in "to order" (need the office to place them)
  let toOrder = 0; try { const rows = await crud.searchPage(PARTS_ORDERS, { order_status: 'to_order' }, { ordered_at: 'desc' }, 200); toOrder = (rows || []).length; } catch (_) {}

  // media that never finished uploading (customer got a finish-link) — needs follow-up
  const mediaPendingJobs = [...new Set(inWin(mediaPending).map((r) => meta(r).job_id).filter(Boolean))];

  const recent = paidWin.slice(0, 25).map((r) => { const m = meta(r); return { at: rowMs(r), job_id: m.job_id, name: m.name, machine: m.machine, town: m.town, amount: m.amount, phone: m.phone, email: m.email }; });

  return {
    statusCode: 200, headers: CORS, body: JSON.stringify({
      ok: true, window_days: days,
      quick_checks: { paid_window: paidWin.length, paid_today: paidToday.length, collected_window: sum(paidWin), collected_today: sum(paidToday) },
      parts: { orders_created_window: inWin(ordersCreated).length, orders_placed_window: inWin(ordersPlaced).length, to_order_now: toOrder },
      action_needed: { to_order_now: toOrder, media_pending: mediaPendingJobs.length, media_pending_jobs: mediaPendingJobs.slice(0, 20) },
      recent,
    }),
  };
};
