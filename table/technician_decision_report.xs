// Stores technician assessments and recommendations after reviewing customer-submitted information.
// ====================================================================
// Customer-facing TDR fields — added 2026-05-05 per Decision D2
// (locked design, see docs/cash-tdr-delivery-design-v1.md §7).
// These fields drive the public-facing TDR view page
// (cash-tdr-customer.html). The internal-vs-customer-facing
// distinction is enforced at the API layer: different endpoints
// return different field sets from this same table.
// ====================================================================
table technician_decision_report {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // Identifier for the associated job.
    int job_id?
  
    // Date when the technician's report was generated.
    date report_date?
  
    // First name of the technician who created the report.
    text technician_first_name? filters=trim
  
    // Last name of the technician who created the report.
    text technician_last_name? filters=trim
  
    // Technician's confidence level in the assessment (e.g., 'high', 'medium', 'low').
    text confidence_level? filters=trim
  
    // The part number verified by the technician.
    text verified_part_number? filters=trim
  
    // Confidence level in the identified part number (e.g., 'high', 'moderate', 'low').
    text part_number_confidence? filters=trim
  
    // Estimated cost range for the repair.
    text estimated_repair_cost_range? filters=trim
  
    // Rating of how feasible a DIY repair is (e.g., 'easy', 'difficult').
    text diy_feasibility_rating? filters=trim
  
    // Technician's final recommendation for the job.
    text final_recommendation? filters=trim
  
    // Any additional notes from the technician.
    text technician_notes? filters=trim
  
    // Timestamp of the last update to the report record.
    timestamp updated_at?
  
    int technician_id?
    text problem_summary? filters=trim
    text status? filters=trim
    text report_url? filters=trim
  
    // Categorizes why the failed component broke. Required for warranty claims to determine coverage.
    enum failure_cause? {
      values = [
        "normal_wear"
        "lack_of_maintenance"
        "customer_misuse"
        "pests"
        "power_surge"
        "manufacturer_defect"
        "improper_installation"
        "external_damage"
        "pre_existing"
        "other"
      ]
    
    }
  
    // Free-text evidence or explanation supporting the failure_cause selection. Especially used when failure_cause is "other" or when evidence needs description.
    text failure_cause_notes?
  
    // What test the tech performed to identify the failure. Examples: "multimeter check on inlet valve", "voltage test at compressor", "manual jumper test".
    text diagnostic_test_performed?
  
    // Tech's plain-English diagnosis of the issue. Distinct from problem_summary
    // (customer-reported complaint) and diagnostic_test_performed (the test
    // method). Examples: "Bad door latch switch", "Refrigerant leak at
    // evaporator", "Burnt-out heating element".
    text diagnosis?
  
    // The specific component that failed. Examples: "water inlet valve", "compressor", "control board", "ice maker assembly".
    text failed_component?
  
    // Links this TDR back to the Tech Ant conversation session that produced it. Used for audit trail.
    text tech_ant_session_id?
  
    // Did the technician fully repair the unit today? Values: yes / no / partial.
    text repair_completed?
  
    // Required if repair_completed is no or partial.
    text repair_not_completed_reason?
  
    // Array of parts used during the repair.
    json parts_used?
  
    // Array of parts ordered but NOT used that need to be returned.
    json parts_not_used?
  
    // Total labor time spent on the job in hours.
    decimal labor_time_hours?
  
    // Whether a second visit is required to complete the repair.
    bool second_visit_needed?
  
    // Array of parts where the technician provided a name but didn't know the part number.
    json part_name_only_flags?
  
    // Scheduling decision made by the tech (or Teddy) on this TDR. Drives the Ant Tech Scheduler pipeline.
    enum scheduling_decision? {
      values = [
        "ready_to_schedule"
        "awaiting_parts"
        "customer_constraint"
        "second_visit_needed"
        "not_scheduling"
        "hold_for_customer"
      ]
    
    }
  
    // When the scheduling_decision was last set or changed.
    timestamp scheduling_decision_updated_at?
  
    // Tech (or owner) who set or last changed the scheduling_decision.
    int? scheduling_decision_updated_by? {
      table = "technicians"
    }
  
    // Free-text constraint captured when scheduling_decision = customer_constraint (e.g., "Tuesday afternoons only").
    text scheduling_constraint?
  
    // Tech explicitly overrode a captured field that contradicted their stated
    // conclusion. Audit trail; tech_override_notes carries the reasoning.
    bool tech_override_flag?
  
    // Free-text reason supplied with an override. Required when tech_override_flag is true.
    text tech_override_notes?
  
    // Set true when Ant Tech Assist pushed back on a tech decision because
    // captured data contradicted it. Drives Danielle/Teddy review queue.
    bool ant_data_flag?
  
    // Ant's pushback reasoning (the data point and the contradiction).
    text ant_flag_reason?
  
    // Plain-English customer-facing version of the diagnosis. Sanitized
    // for customer view (no internal jargon, no failure_cause categories).
    // Distinct from the `diagnosis` field above which is Teddy's internal
    // assessment for the technician.
    text customer_facing_diagnosis?
  
    // Signed token used in the customer-facing SMS link. Indexed for
    // fast lookup on every TDR view page load. Null on existing rows
    // (only set when send_qc_diagnosis_to_customer fires).
    text public_view_token? filters=trim
  
    // When the customer-facing TDR SMS was first sent. Null until sent.
    timestamp sent_to_customer_at?
  
    // When the customer first opened the public TDR view page. Null
    // until first view.
    timestamp viewed_at?
  
    // When the public token should stop accepting customer choices.
    // Null = no expiry (server-side default applies).
    timestamp expires_at?
  
    // The $50 already paid for diagnosis credits ONCE per job, against
    // the first We Install option chosen. Default 5000 (cents = $50).
    // Overrideable per job if Teddy waives or adjusts the credit.
    int labor_credit_cents?=5000
  
    // When the customer clicked "Confirm and Pay" on the public TDR view
    // page. Set once, never updated. Locked decision 2026-05-05: token
    // expires immediately after Confirm and Pay (all decisions final, no
    // revisiting). qc_diagnosis_view rejects further loads of the same
    // token after this is set.
    timestamp confirmed_at?
  
    // Stripe Checkout Session ID minted when customer clicked Confirm and Pay
    // (Phase 1c step 3d.2 2026-05-06). Set on successful POST to /v1/checkout/sessions.
    text stripe_checkout_session_id? filters=trim
  
    // Timestamp of session creation (independent of confirmed_at, which marks
    // payment success).
    timestamp stripe_session_created_at?
  
    // Stripe PaymentIntent ID from checkout.session.completed webhook
    // (Phase 1c step 3d.3 2026-05-06).
    text stripe_payment_intent_id? filters=trim
  
    // Amount paid in cents per the completed Checkout Session.
    int stripe_amount_paid_cents?
  
    int company_id?=1
  
    // Client-generated key for offline-sync deduplication
    text? client_idempotency_key?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "public_view_token"}]}
  ]

  guid = "rbHCHnvbuCKf8idBzRfuXMwGogc"
}