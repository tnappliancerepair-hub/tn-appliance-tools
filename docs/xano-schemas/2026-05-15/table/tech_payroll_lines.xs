// Per-job, per-tech entries that roll up into a tech_payroll_periods
// row. Written by the payment intake endpoints when a warranty line
// matches a job, AND by the stripe-webhook for self-pay cash jobs.
// These rows are the "ledger" — every dollar owed to a tech is one
// of these rows, traceable back to the source payment.
//
// When the owner approves a payroll period, the commission_amount
// values on these rows are FROZEN. Subsequent changes to rates or
// matches do not retroactively change paid-out commissions; instead
// they create new lines in the next period.
//
// Created 2026-05-15 as part of the financial system build.
table tech_payroll_lines {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }

    int? period_id? {
      table = "tech_payroll_periods"
    }

    int? tech_id? {
      table = "technicians"
    }

    int? job_id? {
      table = "jobs"
    }

    // FK back to the warranty_payment_lines row that triggered this
    // payroll line. NULL for self-pay (Stripe) jobs — those don't have
    // a warranty payment line; the Stripe payment intent serves the
    // same audit role.
    int? warranty_payment_line_id? {
      table = "warranty_payment_lines"
    }

    text? claim_number? filters=trim

    // 'AHS' | 'SquareTrade' | 'NSA' | '210' | 'Cash'. Free-text but the
    // dashboard groupings rely on exact match — kept in lockstep with
    // warranty_vendor_accounts.company values (uppercased).
    text? warranty_company? filters=trim

    decimal? labor_paid?=0
    decimal? commission_rate?=0
    decimal? commission_amount?=0

    decimal? parts_paid?=0
    decimal? parts_cost?=0
    decimal? parts_markup_pct?=0
    decimal? parts_profit?=0

    decimal? tax_collected?=0
    decimal? tax_rate?=0
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "period_id"}, {name: "tech_id"}]}
    {type: "btree", field: [{name: "tech_id"}, {name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "job_id"}]}
    {type: "btree", field: [{name: "warranty_payment_line_id"}]}
  ]
}
