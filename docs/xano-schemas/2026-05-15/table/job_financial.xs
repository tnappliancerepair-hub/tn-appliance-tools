// Stores all financial data tied to appliance repair jobs.
table job_financial {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // Identifier for the associated job.
    int job_id?
  
    // Fee charged for diagnosis.
    decimal diagnostic_fee?
  
    // Credit applied against the diagnostic fee.
    decimal diagnostic_credit_applied?
  
    // Cost of parts for the job.
    decimal parts_cost?
  
    // Markup applied to parts cost.
    decimal parts_markup?
  
    // Selling price of parts.
    decimal parts_sell_price?
  
    // Price charged for labor.
    decimal labor_price?
  
    // Payout amount for labor.
    decimal labor_payout?
  
    // Amount of tax applied.
    decimal tax_amount?
  
    // Total revenue generated from the job.
    decimal total_revenue?
  
    // Total cost incurred for the job.
    decimal total_cost?
  
    // Gross profit from the job.
    decimal gross_profit?
  
    // Current payment status (e.g., 'unpaid', 'paid', 'warranty_pending').
    text payment_status? filters=trim
  
    // Expected payout from warranty.
    decimal warranty_payout_expected?
  
    // Actual payout received from warranty.
    decimal warranty_payout_received?
  
    // Vendor from whom parts were ordered.
    text parts_ordered_from? filters=trim
  
    // Reference number for the parts order.
    text parts_order_reference? filters=trim
  
    // Internal notes related to job financials.
    text financial_notes? filters=trim

    // Timestamp of the last update to the financial record.
    timestamp updated_at?

    // ─── Financial-system extension (2026-05-15) ────────────────────
    // Additive only — existing readers don't reference these and stay
    // working. See docs/financial-system-design-2026-05-15.md §6.6.

    // FK → warranty_payment_lines.id. The single line on a warranty
    // payment batch that paid this job. NULL while job is unpaid; NULL
    // for self-pay (Stripe) jobs.
    int? warranty_payment_line_id? {
      table = "warranty_payment_lines"
    }

    // FK → warranty_vendor_accounts.id. Which account paid this job.
    // Snapshot at payment time — if account renames or moves state
    // later, the historical record stays accurate.
    int? warranty_vendor_account_id? {
      table = "warranty_vendor_accounts"
    }

    // Computed markup over parts_cost. 100 = 100% markup (i.e. sell at
    // 2x cost). Stored explicitly so dashboard analytics can show
    // markup distributions without recomputing every time.
    decimal? parts_markup_pct?

    // Aliases of the legacy fields — kept in lockstep on write so new
    // readers can use the explicit names without breaking old readers.
    decimal? parts_revenue?  // mirrors parts_sell_price
    decimal? labor_revenue?  // mirrors labor_price

    // Tech commission paid out on this job. Snapshot — not recomputed
    // from technicians.commission_rate at read time, so changing the
    // rate doesn't retroactively change paid-out commission.
    decimal? tech_commission_amount?

    // Tax collected from the warranty company on parts. For TN this is
    // parts_revenue * 0.0925. For LA this is manually entered per job
    // until the parish lookup is built (Phase 5+).
    decimal? tax_collected?
    decimal? tax_rate?  // 9.25 for TN; varies for LA

    // Bottom line: revenue - (parts_cost + labor_payout + commission + tax remitted).
    decimal? net_profit?

    // When the warranty payment_line that paid this job was parsed.
    timestamp? paid_date?

    // EFT reference / advice number from the payment header. Lets
    // bookkeeper-style audits cross-reference jobs to bank statements.
    text? eft_reference? filters=trim
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "job_id"}]}
    {type: "btree", field: [{name: "payment_status"}]}
    {type: "btree", field: [{name: "warranty_payment_line_id"}]}
    {type: "btree", field: [{name: "warranty_vendor_account_id"}]}
  ]

  guid = "W5iNY2uw4dQaXZ6K89i3Cn62bCI"
}