// Individual claim lines within a warranty payment batch. One row per
// settled claim. After parsing, each line is matched against the jobs
// table (by claim_number for SquareTrade/210/NSA, by dispatch_id for
// AHS). Matched lines populate tech_id from the job, then calculate
// commission and tax. Disputed lines (gross != net) hold commission
// at $0 until the owner resolves them from the dashboard.
//
// See docs/financial-system-design-2026-05-15.md §6.3 for full field
// docs and §8 for the dispute/commission rules.
//
// Created 2026-05-15 as part of the financial system build.
table warranty_payment_lines {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }

    int? batch_id? {
      table = "warranty_payment_batches"
    }

    // Identifier from the remittance line. SquareTrade ships claim_number;
    // AHS ships dispatch_id; 210/NSA — one of the two. Parsers populate
    // whichever the format provides; the matcher tries both fields.
    text? claim_number? filters=trim
    text? dispatch_id? filters=trim
    text? invoice_number? filters=trim

    text? customer_name? filters=trim
    text? model_number? filters=trim
    text? address?

    // What the line breaks down to. Some warranty companies report just
    // a single total; the parsers default labor/parts/other to 0 in that
    // case and rely on the jobs table for the breakdown.
    decimal? labor_amount?=0
    decimal? parts_amount?=0
    decimal? other_amount?=0
    decimal? gross_amount?=0  // header-stated invoice/billed amount
    decimal? net_amount?=0    // what they actually paid
    decimal? total_amount?=0  // alias of net_amount for parser convenience

    // FK to the job once matched. Stays null when match_status='unmatched'.
    int? job_id? {
      table = "jobs"
    }

    // FK to the technician (resolved from job.technician_id after match).
    // Snapshotted here so commission calc doesn't have to re-JOIN once
    // payroll is approved.
    int? tech_id? {
      table = "technicians"
    }

    // 'matched' | 'unmatched' | 'disputed' | 'partial'.
    text? match_status?=unmatched filters=trim

    // Dispute math: when gross != net, this is the shortfall. Commission
    // calculates on net_amount in dispute cases, but only AFTER the
    // owner resolves the dispute. Until then, commission_amount stays 0.
    decimal? dispute_amount?=0
    text? dispute_notes?

    // After owner clicks resolve in the dashboard:
    //   'accept_partial' — commission recalculates on net_amount, line
    //                      moves to match_status='matched'
    //   'rebill'         — leave commission at 0, expect a future line
    //                      to true-up; line stays 'disputed' for audit
    //   'write_off'      — commission stays 0 permanently; line moves
    //                      to match_status='matched' for accounting
    text? resolution_status? filters=trim
    timestamp? resolved_at?
    int? resolved_by? {
      table = "user"
    }

    // Snapshot of commission_rate at match time so changing the rate
    // later doesn't retroactively change paid-out commissions.
    decimal? commission_rate?=0
    decimal? commission_amount?=0

    // Tax-on-parts. TN: 9.25 hardcoded. LA: manually entered per
    // job until the parish lookup ships.
    decimal? tax_amount?=0
    decimal? tax_rate?=0

    // The original line text from the remittance — kept verbatim for
    // audit and for re-parsing if format changes detected.
    text? raw_line?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "batch_id"}]}
    {type: "btree", field: [{name: "claim_number"}]}
    {type: "btree", field: [{name: "dispatch_id"}]}
    {type: "btree", field: [{name: "job_id"}]}
    {type: "btree", field: [{name: "tech_id"}, {name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "match_status"}]}
  ]
}
