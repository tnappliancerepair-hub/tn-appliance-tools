// cash-jobs — the Cash Customers command center data. Every out-of-pocket (paying)
// customer as an actionable record so a real BUYER is never buried in the warranty
// sea. Cash = explicit self_pay type OR no warranty entity (no company/claim/dispatch).
// Marks paid (Stripe / Quick Check) and sorts MOST-URGENT first: someone who PAID
// but isn't scheduled yet sits at the very top — they gave us money and are waiting.
//
//   GET  -> { ok, total, counts:{lane:n}, jobs:[{...lane...}] }
'use strict';
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

exports.config = { timeout: 26 };

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
const TERMINAL = /cancel/i;

// Cash / out-of-pocket = self-pay OR no warranty entity behind it.
function isCash(j) {
  const ct = String(j.customer_type || '').toLowerCase();
  if (ct === 'self_pay' || ct === 'cash' || ct === 'customer_pay') return true;
  return !(j.warranty_company || '').trim() && !(j.claim_number || '').trim() && !(j.dispatch_source_id || '').trim();
}

exports.handler = async function () {
  // 1) every job from the board feed (has the denorm fields we need).
  let jobs = [];
  try {
    const d = await fetch(`${XANO}/get_office_kanban`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
    jobs = d.jobs || d.items || [];
  } catch (_) { return json(200, { ok: false, error: 'feed_failed' }); }
  const cash = jobs.filter((j) => isCash(j) && !TERMINAL.test(String(j.scheduling_status || '') + String(j.current_status || '')));

  // 2) who PAID (Stripe checkout + Quick Check) -> {job_id: {amount, at}}.
  const paid = {};
  try {
    for (const act of ['customer_payment_received', 'quick_check_paid']) {
      const rows = await crud.searchPage(crud.TABLES.event_log, { action: act }, { id: 'desc' }, 400);
      for (const r of (rows || [])) {
        const m = meta(r); const jid = String(m.job_id || ''); if (!jid || jid === '0') continue;
        const amt = Number(m.amount || 0) || 0;
        if (!paid[jid]) paid[jid] = { amount: 0, at: Number(r.created_at || m.at_ms || 0) };
        paid[jid].amount += amt;
      }
    }
  } catch (_) {}

  // 3) shape each cash job + assign a lane.
  const now = Date.now();
  const out = cash.map((j) => {
    const ss = String(j.scheduling_status || '').toLowerCase(), cs = String(j.current_status || '').toLowerCase();
    const hasDate = Number(j.scheduled_start || 0) > 0;
    const p = paid[String(j.id)] || null;
    const isPaid = !!p || String(j.payment_status || '').toLowerCase() === 'paid';
    let lane;
    if (ss === 'completed' || cs === 'completed') lane = isPaid ? 'paid' : 'collect';       // done: paid vs collect $
    else if (ss === 'in_progress' || cs === 'in_progress') lane = 'working';                // tech on it
    else if (hasDate) lane = 'scheduled';                                                   // booked
    else lane = isPaid ? 'new_paid' : 'new';                                                // waiting: paid-first = URGENT
    return {
      id: j.id,
      name: [j.customer_first, j.customer_last].filter(Boolean).join(' ') || '(no name)',
      phone: j.customer_phone || '',
      appliance: j.appliance || j.appliance_type || '',
      problem: String(j.problem_summary || '').replace(/\s+/g, ' ').slice(0, 200),
      city: j.service_city || '', zip: j.service_zip || '',
      status: ss || cs, scheduled_start: Number(j.scheduled_start || 0),
      paid: isPaid, paid_amount: p ? p.amount : 0,
      created_at: Number(j.created_at || 0),
      days: j.created_at ? Math.floor((now - Number(j.created_at)) / 86400000) : 0,
      lane,
    };
  });

  // Stripe payments that couldn't be auto-linked (guest Link, no phone/job_id) — the
  // office assigns these to a job with one tap. Logged by stripe-reconcile; drop any
  // already matched/reconciled. This is how a paid buyer like Carol gets credited.
  let unmatchedPayments = [];
  try {
    const [um, mt, rec] = await Promise.all([
      crud.searchPage(crud.TABLES.event_log, { action: 'stripe_payment_unmatched' }, { id: 'desc' }, 200),
      crud.searchPage(crud.TABLES.event_log, { action: 'stripe_payment_matched' }, { id: 'desc' }, 200),
      crud.searchPage(crud.TABLES.event_log, { action: 'stripe_payment_reconciled' }, { id: 'desc' }, 400),
    ]);
    const done = new Set();
    for (const r of (mt || [])) { const m = meta(r); if (m.charge_id) done.add(String(m.charge_id)); }
    for (const r of (rec || [])) { const m = meta(r); if (m.charge_id) done.add(String(m.charge_id)); }
    const seen = new Set();
    for (const r of (um || [])) { const m = meta(r); const cid = String(m.charge_id || ''); if (!cid || done.has(cid) || seen.has(cid)) continue; seen.add(cid); unmatchedPayments.push({ charge_id: cid, amount: Number(m.amount || 0), name: m.name || '', email: m.email || '', phone: m.phone || '', created: Number(m.created || m.at_ms || 0) }); }
  } catch (_) {}

  // Most-urgent first: paid-and-waiting, then new, then scheduled/working/collect/paid.
  const order = { new_paid: 0, new: 1, scheduled: 2, working: 3, collect: 4, paid: 5 };
  out.sort((a, b) => (order[a.lane] - order[b.lane]) || (b.paid_amount - a.paid_amount) || (a.created_at - b.created_at));
  const counts = {}; out.forEach((j) => { counts[j.lane] = (counts[j.lane] || 0) + 1; });
  // "needs attention" = paying customers not yet scheduled + any unpaid new lead.
  const attention = (counts.new_paid || 0) + (counts.new || 0) + (counts.collect || 0) + unmatchedPayments.length;
  return json(200, { ok: true, total: out.length, counts, attention, unmatched_payments: unmatchedPayments, jobs: out });
};
