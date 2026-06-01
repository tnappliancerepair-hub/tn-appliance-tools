// One row per distinct failure on a Technician Decision Report. A TDR is the
// header (one per job); tdr_failure rows are the children, each carrying its
// own pricing options and customer choice. Locked by design decisions D1-D4
// (2026-05-05) — see docs/cash-tdr-delivery-design-v1.md §7.
table tdr_failure {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // The TDR header this failure belongs to. Required.
    int tdr_id {
      table = "technician_decision_report"
    }
  
    // Teddy's plain-English description of this specific failure.
    // Examples: "Ice maker not producing ice", "Door gasket torn",
    // "Drain pump bearings noisy".
    text failure_description filters=trim
  
    // True if this failure came from the customer's intake / on-site complaint.
    // False if Teddy surfaced it during diagnosis (the customer didn't mention
    // it, but Teddy found it). Drives the "Tenant reported" vs "Found during
    // diagnosis" badge on the customer-facing TDR view page.
    bool tenant_reported?
  
    // OEM part number Teddy recommends for this specific failure.
    text recommended_oem_part_number? filters=trim
  
    // What TN Appliance pays Marcone (or other OEM source) for the part,
    // in cents. Customer-facing OEM part price = this × 1.30, computed at
    // checkout time. NEVER stored as customer-facing price (Phase 1c step 3e
    // 2026-05-06: renamed from recommended_oem_part_price_cents for clarity).
    int oem_part_our_cost_cents?
  
    // Amazon equivalent part number, if available.
    text recommended_amazon_part_number? filters=trim
  
    // What TN Appliance pays Amazon for the compatible generic part, in
    // cents. Customer-facing Amazon part price = this × 1.30 at checkout.
    int amazon_part_our_cost_cents?
  
    // What the customer pays for labor (NO markup applied — labor is set
    // at customer-facing rate). Used as-is in Stripe line items, with $50
    // Quick Check Credit subtracted at order level when labor present.
    // Judgment-driven per Decision D3 (2026-05-05): Teddy uses domain
    // knowledge about first-repair vs incremental labor, no formula.
    int labor_customer_cost_cents?
  
    // The customer's choice for this failure. Default 'pending' until
    // customer picks an option on the TDR view page. Warranty jobs cannot
    // transition to 'skip' (enforced at API layer per §6).
    enum selected_option?=pending {
      values = [
        "pending"
        "diy_oem"
        "diy_amazon"
        "install_oem"
        "install_amazon"
        "skip"
      ]
    
    }
  
    // When the customer made their choice for this failure.
    timestamp selected_at?
  
    // When this specific failure was fulfilled (DIY part shipped or
    // We Install completed). Null while pending or in progress.
    timestamp fulfilled_at?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "tdr_id"}]}
    {type: "btree", field: [{name: "selected_option"}]}
  ]

  guid = "bkyfkv11kqTYaEM924tKBNQTIYI"
}