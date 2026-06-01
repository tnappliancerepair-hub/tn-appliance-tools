// Stores information about customers.
table customer {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // Customer's first name
    text first_name? filters=trim
  
    // Customer's last name
    text last_name? filters=trim
  
    // Customer's phone number
    text phone? filters=trim
  
    // Customer's email address
    text email? filters=trim
  
    // Customer's street address
    text address? filters=trim
  
    // Customer's city
    text city? filters=trim
  
    // Customer's state
    text state? filters=trim
  
    // Customer's postal code
    text zip? filters=trim
  
    // Convenience field showing the most recent waiver signature across all of this customer's jobs.
    timestamp last_waiver_signed_at?
  
    // Flag for VAPI-first routing (for elderly or non-texting customers).
    bool prefers_voice?
  
    // What the customer used during intake (e.g., "Jim" when first_name is
    // "James"). Used in customer-facing SMS templates. Falls back to first_name
    // when empty.
    text preferred_name? filters=trim
  
    // ====================================================================
    // Composite dedup signature added 2026-05-12 per Phase A1 amendment.
    // Format: "{phone10}|{addr_norm}" for the happy path; sentinels
    // "NOPHONE|{addr_norm}" or "{phone10}|NOADDR" for partial cases;
    // null when both phone and address normalization failed.
    // Computed in JS by netlify/functions/_lib/normalize.js
    // (buildDedupSignature) before the parser POSTs to Xano. XS-side
    // string manipulation is deliberately avoided here per footgun #28.
    // Indexed btree (NOT unique — rental owners with multiple properties
    // may legitimately share signatures across customer rows).
    // ====================================================================
    text dedup_signature? filters=trim
  
    // Self-FK: when phone matches an existing customer but address differs
    // (same human, distinct property — common for rental owners), the new
    // customer row sets related_customer_id to the FIRST-created customer
    // for that phone. NULL when no related customer exists.
    int? related_customer_id? {
      table = "customer"
    }
  
    int company_id?=1
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "dedup_signature"}]}
    {type: "btree", field: [{name: "related_customer_id"}]}
  ]

  guid = "0OCb1SqPL_7rf13HoufVRuXKr6M"
}