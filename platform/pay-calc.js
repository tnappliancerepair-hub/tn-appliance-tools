// pay-calc — the ONE place tech pay is computed, so the owner board and the tech app can
// never disagree (they read this same math). "Write once (the invoice) -> pay falls out."
//
// A tech's cut for a job derives from: the invoice's LABOR + the commission RULE (per-tech
// override, else the company default). The money's STATE is shown honestly, never one guess:
//   • earned    — job done + invoice exists: your cut IF it pays in full (pending)
//   • collected — the invoice is marked paid: this is your next check (pay-on-collection)
//   • paid      — already handed over (a tech_payout row exists)
// Nothing here is stored; it's recomputed from the live rows, so a late/short warranty
// remittance just updates the number in place — a smaller check is never a surprise.
(function () {
  'use strict';
  function n(x) { return Number(x) || 0; }

  // The company default rule from company.settings.commission (jsonb).
  function companyDefault(settings) {
    var c = (settings && settings.commission) || {};
    if (c.type === 'flat_per_job') return { type: 'flat_per_job', flat_cents: Math.round(n(c.flat_cents)) };
    // default: % of labor (0 until the owner sets it -> honest $0, never fabricated)
    return { type: 'labor_pct', pct: n(c.labor_pct) };
  }

  // The rule that applies to a tech: their own override wins, else the company default.
  function ruleFor(tech, compDefault) {
    var t = tech || {};
    if (t.commission_type === 'labor_pct' && t.commission_pct != null) return { type: 'labor_pct', pct: n(t.commission_pct) };
    if (t.commission_type === 'flat_per_job' && t.commission_flat_cents != null) return { type: 'flat_per_job', flat_cents: Math.round(n(t.commission_flat_cents)) };
    return compDefault || { type: 'labor_pct', pct: 0 };
  }

  // The tech's earned cents for one job's invoice under a rule.
  function earned(laborCents, rule) {
    if (!rule) return 0;
    if (rule.type === 'flat_per_job') return Math.round(n(rule.flat_cents));
    return Math.round(n(laborCents) * n(rule.pct) / 100);
  }

  // Per-job pay state from a job + its invoice (+ paid cents already recorded for it).
  // invoice: { labor_cents, status } — collected when status === 'paid'.
  function jobPay(job, invoice, rule, paidCents) {
    var labor = invoice ? n(invoice.labor_cents) : 0;
    var e = invoice ? earned(labor, rule) : 0;
    var isCollected = !!(invoice && invoice.status === 'paid');
    var paid = Math.round(n(paidCents));
    return {
      job_id: job && job.id,
      labor_cents: labor,
      earned_cents: e,                                   // your cut if it pays in full
      collected: isCollected,                            // customer/vendor has paid the invoice
      collectible_cents: isCollected ? e : 0,            // now owed to you (pay-on-collection)
      paid_cents: paid,                                  // already on a check
      owed_now_cents: Math.max(0, (isCollected ? e : 0) - paid), // collected but not yet paid out
      state: paid >= e && e > 0 ? 'paid' : (isCollected ? 'collected' : 'earned'),
    };
  }

  // Roll a set of per-job pays into totals for a pay lens.
  function totals(rows) {
    return (rows || []).reduce(function (t, r) {
      t.earned_cents += r.earned_cents;
      t.collectible_cents += r.collectible_cents;
      t.paid_cents += r.paid_cents;
      t.owed_now_cents += r.owed_now_cents;
      return t;
    }, { earned_cents: 0, collectible_cents: 0, paid_cents: 0, owed_now_cents: 0 });
  }

  // Human label for a rule (for the settings UI + a tech's "how you're paid" line).
  function ruleLabel(rule) {
    if (!rule) return 'not set';
    if (rule.type === 'flat_per_job') return '$' + (n(rule.flat_cents) / 100).toFixed(0) + ' per job';
    return n(rule.pct) + '% of labor';
  }

  window.PayCalc = { companyDefault: companyDefault, ruleFor: ruleFor, earned: earned, jobPay: jobPay, totals: totals, ruleLabel: ruleLabel };
})();
