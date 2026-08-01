// cash-jobs — the Cash Customers command center data. Every out-of-pocket (paying)
// customer as an actionable record so a real BUYER is never buried in the warranty sea.
//
// CASH DETECTION (tightened 2026-08-01 — Teddy: "warranty jobs get mistaken for cash,
// especially early ones"): a positive cash signal (self_pay type, a cash intake source,
// or a real payment) AND no warranty signal. Warranty ALWAYS wins — a job with any
// warranty entity OR a warranty intake source is never shown as cash, even if its
// warranty_company field is blank (the early-data case that caused the mislabeling).
//
//   GET  -> { ok, total, counts:{lane:n}, attention, unmatched_payments:[...], jobs:[...] }
'use strict';
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

exports.config = { timeout: 26 };

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

const TERMINAL = /cancel/i;
const CASH_SRC = /web.?chat|appliance.?ai|quick.?check|self.?pay|in.?home|customer.?pay|\bcash\b/i;
const WARR_SRC = /ahs|service.?power|servicepower|allstate|\bnsa\b|square.?trade|frontdoor|dispatch|email_/i;

// Cash = a positive cash signal AND no warranty signal (warranty wins).
function isCash(j, isPaid) {
  const ct = String(j.customer_type || '').toLowerCase();
  const src = String(j.intake_source || '').toLowerCase();
  const warrantySig = !!(String(j.warranty_company || '').trim() || String(j.claim_number || '').trim() || String(j.dispatch_source_id || '').trim() || WARR_SRC.test(src));
  if (warrantySig) return false;
  const cashSig = ct === 'self_pay' || ct === 'cash' || ct === 'customer_pay' || CASH_SRC.test(src) || !!isPaid;
  return cashSig;
}

exports.handler = async function () {
  // 1) board feed — retry, because get_office_kanban intermittently returns empty under
  // load (a flaky empty pull must not blank the cash board).
  let jobs = [];
  for (let a = 0; a < 3 && !jobs.length; a++) {
    try { const d = await fetch(`${XANO}/get_office_kanban`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json()); jobs = d.jobs || d.items || []; } catch (_) {}
    if (!jobs.length && a < 2) await new Promise((r) => setTimeout(r, 800));
  }
  if (!jobs.length) return json(200, { ok: false, error: 'feed_empty', total: 0, counts: {}, attention: 0, unmatched_payments: [], jobs: [] });

  // 2) who PAID (Stripe checkout + Quick Check) -> {job_id: {amount}}.
  const paid = {};
  try {
    for (const act of ['customer_payment_received', 'quick_check_paid']) {
      const rows = await crud.searchPage(crud.TABLES.event_log, { action: act }, { id: 'desc' }, 400);
      for (const r of (rows || [])) { const m = meta(r); const jid = String(m.job_id || ''); if (!jid || jid === '0') continue; const amt = Number(m.amount || 0) || 0; if (!paid[jid]) paid[jid] = { amount: 0 }; paid[jid].amount += amt; }
    }
  } catch (_) {}

  // 3) keep only real cash jobs (non-canceled).
  const cash = jobs.filter((j) => {
    if (TERMINAL.test(String(j.scheduling_status || '') + String(j.current_status || ''))) return false;
    const isPaid = !!paid[String(j.id)] || String(j.payment_status || '').toLowerCase() === 'paid';
    return isCash(j, isPaid);
  });

  // 4) shape + lane. A job that's actually DONE (completed status OR job_completed_at set)
  // is never "new" — it goes to collect (owe money) or paid. (Teddy 2026-08-01)
  const now = Date.now();
  const out = cash.map((j) => {
    const ss = String(j.scheduling_status || '').toLowerCase(), cs = String(j.current_status || '').toLowerCase();
    const done = ss === 'completed' || cs === 'completed' || Number(j.job_completed_at || 0) > 0;
    const hasDate = Number(j.scheduled_start || 0) > 0;
    const p = paid[String(j.id)] || null;
    const isPaid = !!p || String(j.payment_status || '').toLowerCase() === 'paid';
    let lane;
    if (done) lane = isPaid ? 'paid' : 'collect';
    else if (ss === 'awaiting_parts' || cs === 'awaiting_parts' || ss === 'held' || cs === 'held') lane = 'parts';  // waiting on parts ≠ needs scheduling
    else if (ss === 'in_progress' || cs === 'in_progress') lane = 'working';
    else if (hasDate) lane = 'scheduled';
    else lane = isPaid ? 'new_paid' : 'new';
    return {
      id: j.id,
      name: [j.customer_first, j.customer_last].filter(Boolean).join(' ') || '(no name)',
      phone: j.customer_phone || '',
      appliance: j.appliance || j.appliance_type || '',
      problem: String(j.problem_summary || '').replace(/\s+/g, ' ').slice(0, 200),
      city: j.service_city || '', zip: j.service_zip || '',
      status: ss || cs, scheduled_start: Number(j.scheduled_start || 0),
      done, paid: isPaid, paid_amount: p ? p.amount : 0,
      created_at: Number(j.created_at || 0),
      days: j.created_at ? Math.floor((now - Number(j.created_at)) / 86400000) : 0,
      lane,
    };
  });

  // 5) unmatched Stripe payments (guest Link, no auto-link) — office assigns with one tap.
  let unmatchedPayments = [];
  try {
    const [um, mt, rec] = await Promise.all([
      crud.searchPage(crud.TABLES.event_log, { action: 'stripe_payment_unmatched' }, { id: 'desc' }, 200),
      crud.searchPage(crud.TABLES.event_log, { action: 'stripe_payment_matched' }, { id: 'desc' }, 200),
      crud.searchPage(crud.TABLES.event_log, { action: 'stripe_payment_reconciled' }, { id: 'desc' }, 400),
    ]);
    const doneSet = new Set();
    for (const r of (mt || [])) { const m = meta(r); if (m.charge_id) doneSet.add(String(m.charge_id)); }
    for (const r of (rec || [])) { const m = meta(r); if (m.charge_id) doneSet.add(String(m.charge_id)); }
    const seen = new Set();
    for (const r of (um || [])) { const m = meta(r); const cid = String(m.charge_id || ''); if (!cid || doneSet.has(cid) || seen.has(cid)) continue; seen.add(cid); unmatchedPayments.push({ charge_id: cid, amount: Number(m.amount || 0), name: m.name || '', email: m.email || '', phone: m.phone || '', created: Number(m.created || m.at_ms || 0) }); }
  } catch (_) {}

  const order = { new_paid: 0, new: 1, scheduled: 2, working: 3, collect: 4, paid: 5 };
  out.sort((a, b) => (order[a.lane] - order[b.lane]) || (b.paid_amount - a.paid_amount) || (a.created_at - b.created_at));
  const counts = {}; out.forEach((j) => { counts[j.lane] = (counts[j.lane] || 0) + 1; });
  const attention = (counts.new_paid || 0) + (counts.new || 0) + (counts.collect || 0) + unmatchedPayments.length;
  return json(200, { ok: true, total: out.length, counts, attention, unmatched_payments: unmatchedPayments, jobs: out });
};
