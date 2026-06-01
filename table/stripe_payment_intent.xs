// One row per Stripe PaymentIntent created in the cash flow QC pipeline.
// Tracks both the $50 entry payment (purpose=qc_diagnosis_50, tdr_failure_id
// null) and the per-failure option payments (purpose=option_payment,
// tdr_failure_id set). Refunds get their own row. Used by the Stripe webhook
// to flip qc_status and tdr_failure.fulfilled_at on payment_intent.succeeded.
// See docs/cash-tdr-delivery-design-v1.md §7 (locked design D1-D4, 2026-05-05).
table stripe_payment_intent {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // The job this payment is associated with. Required.
    int job_id {
      table = "jobs"
    }
  
    // The specific failure being paid for. Non-null for option payments
    // (one row per We Install or DIY part charge). Null for the $50 entry
    // payment (covers the job, not a specific failure) and for refunds
    // that aren't tied to a specific failure.
    int? tdr_failure_id? {
      table = "tdr_failure"
    }
  
    // Stripe's PaymentIntent ID (e.g., "pi_3OAB...xyz"). Required — webhook
    // lookups join on this. Indexed.
    text stripe_payment_intent_id filters=trim
  
    // Which payment moment this row represents. qc_diagnosis_50 = the $50
    // entry payment; option_payment = a per-failure repair charge; refund =
    // a partial or full refund of an earlier intent.
    enum purpose? {
      values = ["qc_diagnosis_50", "option_payment", "refund"]
    }
  
    // Amount in cents. Required.
    int amount_cents
  
    // Lifecycle: pending until Stripe confirms, then succeeded / failed /
    // refunded. The Stripe webhook flips this on payment_intent.* events.
    enum status?=pending {
      values = ["pending", "succeeded", "failed", "refunded"]
    }
  
    // Full Stripe webhook payload metadata blob, stored as JSON-stringified
    // text for audit. Useful for replaying or debugging webhook deliveries.
    text stripe_metadata_json?
  
    // Populated on failed payments — Stripe's failure_message or our own
    // explanation of why the intent didn't succeed. Null on success.
    text error_message?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "job_id"}]}
    {type: "btree", field: [{name: "tdr_failure_id"}]}
    {type: "btree", field: [{name: "stripe_payment_intent_id"}]}
    {type: "btree", field: [{name: "status"}]}
  ]

  guid = "jQVbLtxAxGmisbPm1DiVSHG1t-Q"
}