// Tech Ant Assist live in-field copilot sessions. One row per tech-job pairing
// from HCP work_status=in_progress until job.completed (or auto-close on next
// in_progress for a different job). See docs/ant-tech-assist-design-v1.md.
table tech_assist_session {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // Updated by handlers on every session mutation.
    timestamp updated_at?
  
    // The job this session is anchored to. Required.
    int job_id {
      table = "jobs"
    }
  
    // The technician this session belongs to. Required.
    int technician_id {
      table = "technicians"
    }
  
    // Mirrored from jobs.warranty_company at session start; tech may correct
    // it during the conversation if the job was misclassified.
    text warranty_company? filters=trim
  
    // Drives which required-field set applies for the completion gate.
    enum customer_type?=warranty {
      values = ["warranty", "self_pay", "other"]
    }
  
    // Lifecycle: active -> awaiting_completion (after HCP completed but
    // required fields still missing) -> complete | abandoned | escalated.
    enum status?=active {
      values = [
        "active"
        "awaiting_completion"
        "complete"
        "abandoned"
        "escalated"
      ]
    
    }
  
    // Free-form keys mapping to captured values. Example:
    // {"freezer_temp": 28, "fresh_food_temp": 45, "compressor_running": false,
    //  "model_tag_photo_url": "..."}.
    json captured_data?
  
    // Array of remaining required field name strings, derived from
    // warranty_company on session start. Example: ["freezer_temp",
    // "model_tag_photo", "failure_cause"].
    json required_fields_remaining?
  
    // What kicked this session off. Values: hcp_in_progress, manual.
    text session_start_event? filters=trim
  
    // Last activity timestamp; drives the 2hr completion-gate escalation.
    timestamp last_message_at?
  
    // Set when the 2hr followup elapses with required fields still missing.
    timestamp escalated_at?
  
    // Who the escalation was routed to. Values: danielle, teddy.
    text escalated_to? filters=trim
  
    int company_id?=1
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "technician_id"}]}
    {type: "btree", field: [{name: "job_id"}]}
    {type: "btree", field: [{name: "status"}]}
  ]

  guid = "H8epFW4YtDK0iXBFHGx4iGg1azw"
}