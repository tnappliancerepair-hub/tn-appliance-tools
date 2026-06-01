// Stores information about service jobs.
// ====================================================================
// Cash flow QC pipeline columns — added 2026-05-05 per Decisions D1+D2
// (locked design, see docs/cash-tdr-delivery-design-v1.md §7).
// qc_status carries cash-only commercial state (NULL for warranty);
// pre-diagnosis lifecycle uses scheduling_status (shared cash+warranty,
// extended in Push 5 not this push).
// ====================================================================
// ====================================================================
// Multi-party customer columns — added 2026-05-05 per Decision D2 / §4.
// Defaults to the existing customer_id when NULL, so legacy code paths
// and warranty jobs are unchanged. Set explicitly for rental and
// commercial scenarios where bill_to ≠ on_site_contact.
// ====================================================================
// ====================================================================
// HCP polling sync columns added 2026-05-07 (Phase 1g+ post-backfill).
// Used by hcp_poll_recent_jobs to compute lookback window and to
// mirror HCP's authoritative state for jobs sourced from HCP.
// ====================================================================
table jobs {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // Identifier for the associated customer.
    int customer_id?
  
    // Unique identifier for the service job.
    text job_number? filters=trim
  
    // The current operational status of the job (e.g., 'pending', 'in_progress').
    text current_status? filters=trim
  
    // A user-friendly description of the job's status.
    text friendly_status? filters=trim
  
    // A brief summary of the appliance problem.
    text problem_summary? filters=trim
  
    // The type of appliance being serviced (e.g., 'refrigerator', 'washer').
    text appliance_type? filters=trim
  
    // The brand of the appliance.
    text brand? filters=trim
  
    // The model number of the appliance.
    text model_number? filters=trim
  
    // The payment status for the service job (e.g., 'unpaid', 'paid').
    text payment_status? filters=trim
  
    // Estimated arrival date for any required parts.
    date part_eta?
  
    // Estimated time window for service completion.
    text service_eta_window? filters=trim
  
    // Indicates the origin of the job (e.g., 'quick_check', 'warranty', 'vapi').
    text source_type? filters=trim
  
    // The agent or system responsible for the job's intake (e.g., 'form', 'jimmy', 'ant').
    text source_agent? filters=trim
  
    // Categorizes the customer's payment responsibility (e.g., 'self_pay', 'warranty').
    text customer_type? filters=trim
  
    // The name of the warranty company, if applicable.
    text warranty_company? filters=trim
  
    // The claim number associated with a warranty job.
    text claim_number? filters=trim
  
    // Identifier from an external dispatch system, if applicable.
    text dispatch_source_id? filters=trim
  
    // The serial number of the appliance.
    text serial_number? filters=trim
  
    // The recommended service for the job (e.g., 'quick_check', 'truck_roll').
    text recommended_service? filters=trim
  
    // The status of the customer's service request.
    text request_status? filters=trim
  
    // First preferred availability slot provided by the customer.
    text availability_one? filters=trim
  
    // Second preferred availability slot provided by the customer.
    text availability_two? filters=trim
  
    // Third preferred availability slot provided by the customer.
    text availability_three? filters=trim
  
    // URL to a photo of the appliance.
    text photo_appliance_url? filters=trim
  
    // URL to a photo of the appliance's model tag.
    text photo_model_tag_url? filters=trim
  
    // URL to a video demonstrating the issue.
    text issue_video_url? filters=trim
  
    // Indicates if payment has been collected for the job.
    bool payment_collected?
  
    // Reference ID for the payment transaction in Stripe.
    text stripe_payment_reference? filters=trim
  
    // ID of the form submission associated with the job.
    text form_submission_id? filters=trim
  
    // Overall status of the job (e.g., 'submitted', 'scheduled', 'completed').
    text job_status? filters=trim
  
    // Status of the job triage process (e.g., 'not_reviewed', 'truck_roll_needed').
    text triage_status? filters=trim
  
    // Status of parts required for the job (e.g., 'not_needed', 'ordered', 'delivered').
    text parts_status? filters=trim
  
    // Pipeline state from Ant Tech Scheduler design + legacy values from previous text-typed era.
    // New pipeline values: pending, awaiting_parts, ready, broadcasting, scheduled, in_progress, completed, escalated, canceled, held.
    // Shared cash+warranty values added 2026-05-05 per Decision D1 (locked, see docs/cash-tdr-delivery-design-v1.md §6):
    //   intake_complete, prediagnosis_pending, needs_more_info, no_fix_possible.
    // Legacy values (kept for caller compatibility, deprecate once callers migrate): not_ready, booked.
    // DEPRECATED 2026-05-05: needs_pre_diagnosis - replaced by prediagnosis_pending. Existing data rows preserved;
    // no new code should set this value. Backfill task deferred - UPDATE jobs SET scheduling_status='prediagnosis_pending'
    // WHERE scheduling_status='needs_pre_diagnosis'.
    enum scheduling_status? {
      values = [
        "pending"
        "awaiting_parts"
        "ready"
        "broadcasting"
        "scheduled"
        "in_progress"
        "completed"
        "escalated"
        "canceled"
        "held"
        "not_ready"
        "booked"
        "needs_pre_diagnosis"
        "intake_complete"
        "prediagnosis_pending"
        "needs_more_info"
        "no_fix_possible"
      ]
    
    }
  
    // Denormalized mirror of the latest TDR scheduling_decision for fast filtering.
    enum current_scheduling_decision? {
      values = [
        "ready_to_schedule"
        "awaiting_parts"
        "customer_constraint"
        "second_visit_needed"
        "not_scheduling"
        "hold_for_customer"
      ]
    
    }
  
    // Identifier for the job in Housecall Pro.
    text housecall_pro_job_id? filters=trim
  
    // Identifier for the job in MeisterTask.
    text meister_task_id? filters=trim
  
    // Reference ID for the technician's decision report.
    int technician_decision_report_id?
  
    // Internal notes for team members.
    text notes_internal? filters=trim
  
    text job_type? filters=trim
    int technician_id?
    timestamp? scheduled_start?
    timestamp? scheduled_end?
  
    // Tracks whether the customer has signed the waiver for this specific job.
    bool waiver_signed?
  
    // Timestamp when the waiver was signed.
    timestamp waiver_signed_at?
  
    // Stores the full text of the waiver as it was presented to the customer at signing time, for audit trail.
    text waiver_text_version? filters=trim
  
    // The customer's IP address at time of signing.
    text waiver_ip? filters=trim
  
    // The customer's browser/device user agent at time of signing.
    text waiver_user_agent? filters=trim
  
    // Links to the Jotform submission for the signed waiver.
    text waiver_jotform_submission_id? filters=trim
  
    // Stores values like 'sms_web', 'vapi_voice', or 'in_person_tablet' to track which channel was used to collect the waiver.
    text waiver_channel? filters=trim
  
    // Tracks when the waiver SMS was sent to the customer, separate from when they actually signed.
    timestamp waiver_sent_at?
  
    // Unique Vapi call identifier.
    text vapi_call_id? filters=trim
  
    // Status of the Vapi call.
    text vapi_call_status? filters=trim
  
    // When the outbound Vapi call was triggered.
    timestamp vapi_called_at?
  
    // When the Vapi call ended.
    timestamp vapi_call_ended_at?
  
    // Duration of the Vapi call in seconds.
    int vapi_call_duration?
  
    // URL to the Vapi call recording.
    text vapi_call_recording? filters=trim
  
    // Full transcript of the Vapi call.
    text vapi_call_transcript? filters=trim
  
    // How the intake was collected (e.g., 'jotform', 'vapi', 'web_chat').
    text intake_source? filters=trim
  
    // Brand of the appliance from the Vapi call.
    text appliance_brand? filters=trim
  
    // Model number of the appliance from the Vapi call.
    text appliance_model? filters=trim
  
    // Approximate age of the appliance from the Vapi call.
    text appliance_age? filters=trim
  
    // Customer's description of the problem from the Vapi call.
    text problem_description? filters=trim
  
    // Customer's preferred appointment window from the Vapi call.
    text scheduling_preference? filters=trim
  
    // Whether the customer confirmed the service address.
    bool address_confirmed?
  
    // Best phone number to reach the customer.
    text callback_number? filters=trim
  
    // Whether the customer agreed to send photos.
    bool photos_agreed?
  
    // Outcome of the Vapi call.
    text call_outcome? filters=trim
  
    // When the parts followup call was triggered.
    timestamp parts_followup_called_at?
  
    // The service cluster for this job.
    text cluster? filters=trim
  
    // The service address for the job.
    text service_address? filters=trim
  
    // The city of the service address.
    text service_city? filters=trim
  
    // The state of the service address.
    text service_state? filters=trim
  
    // The ZIP code of the service address.
    text service_zip? filters=trim
  
    // Timestamp of when the tech first opened Tech Ant for this job. Tracks Tech Ant adoption and helps surface jobs where tech started but didn't complete the conversation.
    timestamp tech_ant_chat_started_at?
  
    // Indicates if the post-job feedback request SMS has been sent.
    bool feedback_sent?
  
    // The classification of the customer's feedback (positive, negative, unknown).
    text feedback_type? filters=trim
  
    // The raw text of the customer's feedback reply or followup complaint.
    text feedback_note? filters=trim
  
    // When the post-job feedback request SMS was sent.
    timestamp feedback_sent_at?
  
    // Indicates if the Google review link was sent after positive feedback.
    bool review_link_sent?
  
    // HCP pro_id of currently assigned employee. Updated by hcp_job_webhook on every event. Distinct from technician_id which Teddy controls via Teddy Tool.
    text hcp_assigned_to? filters=trim
  
    // True once Teddy completes pre-diagnosis review in Teddy Tool. Until true, scheduling_status should be prediagnosis_pending.
    bool pre_diagnosis_complete?
  
    // Job time category for daily capacity calculation. Allowed values: "standard" (1 unit, normal repair), "long" (2 units, sealed system / compressor swap / multi-appliance), "all_day" (7 units, full-day install or major project). Tech daily cap is 7 units total. Default standard.
    // Job time category for daily capacity calculation. Allowed values: "standard" (1 unit, normal repair), "long" (2 units, sealed system / compressor swap / multi-appliance), "all_day" (7 units, full-day install or major project). Tech daily cap is 7 units total. Default standard.
    text job_time?=standard
  
    // Customer scheduling classification. Values: "open_schedule" / "must_time" / "emergency"
    // Customer scheduling classification. Values: "open_schedule" / "must_time" / "emergency"
    text scheduling_type?
  
    // Customer's verbatim words describing availability
    // Customer's verbatim words describing availability
    text customer_preference_text?
  
    // Estimated job duration for capacity weighting and slot fitting
    // Estimated job duration for capacity weighting and slot fitting
    int estimated_duration_minutes?=60
  
    // Dispatch lifecycle state. Values: "awaiting_dispatch" / "broadcasting" / "accepted" / "confirmed"
    // Dispatch lifecycle state. Values: "awaiting_dispatch" / "broadcasting" / "accepted" / "confirmed"
    text dispatch_status?="awaiting_dispatch"
  
    // When broadcast SMS fired to cluster techs
    // When broadcast SMS fired to cluster techs
    timestamp broadcast_sent_at?
  
    // technician_id of tech who accepted the broadcast
    // technician_id of tech who accepted the broadcast
    int accepted_by_tech_id?
  
    // When tech accepted the broadcast
    // When tech accepted the broadcast
    timestamp accepted_at?
  
    // True when customer has explicitly consented to receive SMS messages
    // True when customer has explicitly consented to receive SMS messages
    bool sms_consent?
  
    // When the customer gave SMS consent
    // When the customer gave SMS consent
    timestamp? sms_consent_at?
  
    // The cash-flow QC commercial pipeline state. Values follow §6 of the
    // design doc. NULL for warranty jobs (this column is cash-specific).
    enum qc_status? {
      values = [
        "diagnosis_pending"
        "diagnosis_sent"
        "choice_pending"
        "partial_chosen"
        "all_chosen"
        "all_skipped"
        "abandoned"
        "refunded"
      ]
    
    }
  
    // When the $50 entry payment landed via Stripe webhook.
    timestamp qc_diagnosis_paid_at?
  
    // When the customer-facing diagnosis SMS fired to bill_to.
    timestamp qc_diagnosis_sent_at?
  
    // When the customer's most recent failure-choice was recorded
    // (last touch, may be partial across multi-failure flows).
    timestamp qc_choice_made_at?
  
    // The party who pays. NULL means use customer_id.
    int? bill_to_customer_id? {
      table = "customer"
    }
  
    // The party physically at the property. NULL means use customer_id.
    // Set to the tenant in rental scenarios.
    int? on_site_contact_id? {
      table = "customer"
    }
  
    // True when this job involves a rental / multi-party arrangement.
    // Triggers the rental SMS template variant + dual-recipient
    // fulfillment routing per §9.
    bool is_rental?
  
    // The HCP-side updated_at timestamp from the most recent poll.
    // Drives the lookback window for the next poll run. Null on jobs
    // not sourced from HCP. Distinct from Xano's own updated_at which
    // tracks local row modifications.
    timestamp hcp_updated_at?
  
    // Total job amount in cents from HCP (job.total_amount). Mirrored
    // by polling for revenue reconciliation and dashboard surfaces.
    int total_amount_cents?
  
    // ====================================================================
    // Flag added 2026-05-12 per Phase A1 amendment. Flipped to true by the
    // ServicePower email intake parser when customer dedup is partial
    // (PARTIAL_PHONE_ONLY or PARTIAL_ADDR_ONLY) or when an email type
    // indicates human attention is required. Surfaces in the cockpit so
    // Teddy can triage. Default false; never set automatically back to
    // false (Teddy clears it manually after review).
    // ====================================================================
    bool manual_review_needed?
  
    text? parts_decision?
    text? parts_supplier?
    date? parts_eta_date?
    timestamp? parts_ordered_at?
    bool parts_customer_notified?
  
    // Stamped when tech taps On My Way button
    timestamp? tech_en_route_at?
  
    // Stamped when tech taps Start Job button
    timestamp? job_started_at?
  
    // Stamped when tech taps Complete dropdown
    timestamp? job_completed_at?
  
    // Calculated as job_completed_at - job_started_at
    int? time_on_site_minutes?
  
    // Office-side workflow stage (Danielle MeisterTask folder equivalent). Expected values: scheduled, report, upgrade, waiting_auth, completion_appt, follow_up, needs_invoicing. Null = not yet bucketed.
    text? office_stage?
  
    // Customer-supplied access notes from resume-mode chat: gate codes, pets, parking, side door, etc.
    text? access_notes?
  
    // Tech-supplied ETA in unix ms when On My Way button is tapped. Null until tech is en route.
    int? eta_ms?
  
    // True when a vendor (SquareTrade/ServicePower/etc) has pre-set the appointment date. Used by try_auto_schedule to skip the propose flow.
    bool? vendor_locked?
  
    int company_id?=1
  
    // True if this job is being routed via the parallel ANT intake pipeline (not legacy HCP)
    bool parallel_mode?
  
    // Timestamp ms when this warranty job was submitted to the warranty company. NULL means not yet submitted; non-null means submitted.
    timestamp? warranty_submitted_at?
  
    // Tags jobs created via the test harness. Real intake leaves empty. Used for scoped reset_run + scoped mock-scheduler apply.
    text? test_run_id?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "qc_status"}]}
    {type: "btree", field: [{name: "bill_to_customer_id"}]}
    {type: "btree", field: [{name: "on_site_contact_id"}]}
    {type: "btree", field: [{name: "claim_number"}]}
  ]

  guid = "BrWpToo56KkSFAtHEoTcUwjsPVI"
}