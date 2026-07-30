// payroll-audit — owner-gated accuracy check on the tech-pay system. Answers
// "how accurate is our payroll becoming?" by measuring the only thing that
// matters: do COMPLETED jobs convert into CORRECTLY-ATTRIBUTED tech pay?
//
// Pay = sum of office_invoice_logged rows (tech_pay + technician_id) + add-ons
// + tips - payouts. So accuracy = coverage (every completion invoiced) +
// attribution (every invoice has the right tech) + math (tech_pay == rate*labor).
//
//   GET ?secret=<admin>[&start_ms=&end_ms=]   (default = last 30 days)
'use strict';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT = 3;
const RATES = { 1: 0.50, 2: 0.45, 3: 0.40, 4: 0.50, 5: 0.50, 6: 0.40 };
const NAME = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 5: 'Billy', 6: 'John' };

function H() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function m(r) { let x = r && r.metadata; if (typeof x === 'string') { try { x = JSON.parse(x); } catch (_) { x = {}; } } return x || {}; }
function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
function whenOf(row, mm) { return num(mm.at_ms) || num(mm.recorded_at_ms) || num(mm.logged_at_ms) || num(row.created_at) || (typeof row.created_at === 'string' ? (Date.parse(row.created_at) || 0) : 0); }
async function byAction(action, pages) {
  const out = [];
  for (let p = 1; p <= (pages || 10); p++) {
    const r = await fetch(`${META}/table/${EVENT}/content/search`, { method: 'POST', headers: H(), body: JSON.stringify({ search: { action }, sort: { created_at: 'desc' }, per_page: 500, page: p }) });
    if (!r.ok) break;
    const d = await r.json(); const it = (d && d.items) || []; out.push(...it);
    if (it.length < 500) break;
  }
  return out;
}

exports.config = { timeout: 26 };
exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const now = Date.now();
  const start = parseInt(q.start_ms, 10) || (now - 30 * 864e5);
  const end = parseInt(q.end_ms, 10) || now;
  const inP = (row, mm) => { const w = whenOf(row, mm); return w >= start && w <= end; };

  try {
    const [inv, comp, addons, tips] = await Promise.all([
      byAction('office_invoice_logged'), byAction('tech_job_complete'),
      byAction('addon_fulfilled'), byAction('tech_tip_paid'),
    ]);

    // Completions in the window (unique jobs).
    const completed = new Map();
    for (const c of comp) { const mm = m(c); if (!inP(c, mm)) continue; const jid = String(mm.job_id || ''); if (jid && !completed.has(jid)) completed.set(jid, { tech: parseInt(mm.technician_id, 10) || 0 }); }

    // Invoices in the window + data-quality flags.
    const invoicedJobs = new Set();
    let missingTech = 0, missingTechDollars = 0, laborNoPay = 0, rateMismatch = 0;
    const mismatchSample = [];
    const perTech = {};
    const T = (id) => (perTech[id] = perTech[id] || { pay: 0, addons: 0, tips: 0, jobs: 0 });
    for (const r of inv) {
      const mm = m(r); if (!inP(r, mm)) continue;
      const jid = String(mm.job_id || ''); if (jid) invoicedJobs.add(jid);
      const tid = parseInt(mm.technician_id, 10) || 0;
      const pay = num(mm.tech_pay), labor = num(mm.labor);
      if (pay > 0 && !tid) { missingTech++; missingTechDollars += pay; }
      if (labor > 0 && pay === 0) laborNoPay++;
      if (tid && labor > 0 && RATES[tid]) { const exp = labor * RATES[tid]; if (Math.abs(exp - pay) > 1) { rateMismatch++; if (mismatchSample.length < 10) mismatchSample.push({ job_id: jid, tech: NAME[tid] || tid, labor, tech_pay: pay, expected: +exp.toFixed(2) }); } }
      if (tid) { const t = T(tid); t.pay += pay; t.jobs++; }
    }
    for (const a of addons) { const mm = m(a); if (!inP(a, mm)) continue; const tid = parseInt(mm.technician_id, 10) || 0; if (tid) T(tid).addons += num(mm.tech_cut); }
    for (const tp of tips) { const mm = m(tp); if (!inP(tp, mm)) continue; const tid = parseInt(mm.technician_id, 10) || 0; if (tid) T(tid).tips += num(mm.amount); }

    // Coverage: completed jobs that got invoiced.
    let covered = 0; const missing = [];
    for (const [jid, info] of completed) { if (invoicedJobs.has(jid)) covered++; else missing.push({ job_id: jid, tech: NAME[info.tech] || info.tech || '—' }); }
    const totalCompleted = completed.size;

    const techs = Object.keys(perTech).map((tid) => ({
      technician_id: +tid, name: NAME[+tid] || ('Tech ' + tid),
      labor_pay: +perTech[tid].pay.toFixed(2), addons: +perTech[tid].addons.toFixed(2), tips: +perTech[tid].tips.toFixed(2),
      total: +(perTech[tid].pay + perTech[tid].addons + perTech[tid].tips).toFixed(2), invoiced_jobs: perTech[tid].jobs,
    })).sort((a, b) => b.total - a.total);

    // A single honest "accuracy score": coverage weighted, minus attribution/math gaps.
    const covPct = totalCompleted ? covered / totalCompleted : 1;
    const attributionOk = 1 - (missingTech / Math.max(1, invoicedJobs.size));
    const mathOk = 1 - (rateMismatch / Math.max(1, invoicedJobs.size));
    const score = Math.round(100 * (0.6 * covPct + 0.2 * attributionOk + 0.2 * mathOk));

    return json(200, {
      ok: true,
      period: { start_ms: start, end_ms: end, days: Math.round((end - start) / 864e5), start: new Date(start).toISOString().slice(0, 10), end: new Date(end).toISOString().slice(0, 10) },
      accuracy_score: score,
      coverage: { completed_jobs: totalCompleted, invoiced: covered, coverage_pct: Math.round(100 * covPct), completed_not_invoiced: missing.length },
      attribution: { invoices_missing_tech: missingTech, unattributed_dollars: +missingTechDollars.toFixed(2) },
      math: { rate_mismatches: rateMismatch, labor_but_zero_pay: laborNoPay, mismatch_sample: mismatchSample },
      techs,
      completed_not_invoiced_sample: missing.slice(0, 15),
      note: 'Coverage = completed jobs that got an invoice (=tech pay computed). Warranty pay released via EFT is a separate track; those completions can show as "not invoiced" if the office does not log a warranty invoice.',
    });
  } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
};
