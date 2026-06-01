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
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "W5iNY2uw4dQaXZ6K89i3Cn62bCI"
}