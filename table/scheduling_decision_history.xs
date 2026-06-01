// Audit trail for every change to a TDR's scheduling_decision.
// Inserted by the TDR processor whenever a decision changes (or first-set).
table scheduling_decision_history {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // The TDR this decision change applies to.
    int? tdr_id? {
      table = "technician_decision_report"
    }
  
    // The job this decision change applies to (denormalized for faster lookup).
    int? job_id? {
      table = "jobs"
    }
  
    // The decision value before this change. Null for the first decision on a TDR.
    enum previous_decision? {
      values = [
        "ready_to_schedule"
        "awaiting_parts"
        "customer_constraint"
        "second_visit_needed"
        "not_scheduling"
        "hold_for_customer"
      ]
    
    }
  
    // The new decision value being set.
    enum new_decision? {
      values = [
        "ready_to_schedule"
        "awaiting_parts"
        "customer_constraint"
        "second_visit_needed"
        "not_scheduling"
        "hold_for_customer"
      ]
    
    }
  
    // Tech (or owner) who made the change.
    int? changed_by? {
      table = "technicians"
    }
  
    // When the change happened (separate from created_at, which is row-creation time).
    timestamp changed_at?
  
    // Optional notes about why the decision changed.
    text notes?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "tdr_id"}]}
    {type: "btree", field: [{name: "job_id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "OZXUqo33qIl2QDemVvmbC_peMg4"
}