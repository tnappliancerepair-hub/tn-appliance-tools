// One row per pay period. Techs are paid twice monthly — pay_date is
// either the 3rd or the 18th. Each period rolls up the matched
// warranty_payment_lines (plus Stripe self-pay commission lines) into
// a single summary that the owner approves on day 2/3 of the
// reconciliation window.
//
// status lifecycle:
//   pending   — period rolling up new lines; commission math live
//   approved  — locked; tech_payroll_lines snapshots are immutable
//   paid      — ACH sent; paid_at populated
//
// Approval gate (see approve_payroll_POST): no period can move to
// status='approved' while any of its lines are in disputed/unresolved.
//
// Created 2026-05-15 as part of the financial system build.
table tech_payroll_periods {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }

    timestamp period_start
    timestamp period_end

    // Either the 3rd or the 18th of the month. Stored explicitly rather
    // than derived so we can handle weekend/holiday shifts cleanly.
    timestamp pay_date

    // 'pending' | 'approved' | 'paid'.
    text? status?=pending filters=trim

    // Rollup totals — recomputed on each line write while status=pending,
    // frozen at approval time.
    decimal? total_labor_paid?=0
    decimal? total_parts_paid?=0
    decimal? total_commission_owed?=0
    decimal? total_tax_collected?=0

    int? approved_by? {
      table = "user"
    }
    timestamp? approved_at?
    timestamp? paid_at?

    text? notes?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "period_end", op: "desc"}]}
    {type: "btree", field: [{name: "period_start"}, {name: "period_end"}], unique: true}
    {type: "btree", field: [{name: "status"}]}
  ]
}
