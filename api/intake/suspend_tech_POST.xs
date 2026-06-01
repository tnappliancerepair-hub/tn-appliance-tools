// Suspends a tech (active=false) + audits the reason. Used when a
// compliance violation is detected (license expired, insurance lapsed,
// etc).
query suspend_tech verb=POST {
  api_group = "intake"

  input {
    int tech_id
    text reason
  }

  stack {
    db.edit technicians {
      field_name = "id"
      field_value = $input.tech_id
      data = {active: false}
    } as $updated
  
    db.add event_log {
      data = {
        action  : "tech_suspended"
        metadata: ```
          {
                    tech_id : $input.tech_id
                    reason  : $input.reason
                  }|json_encode
          ```
      }
    } as $audit_row
  
    db.add colony_signals {
      data = {
        signal_type    : "TECH_SUSPENDED"
        signal_strength: 90
        source_colony  : "compliance"
        target_colonies: ""
        payload        : `{ tech_id: $input.tech_id, reason: $input.reason }|json_encode`
      }
    } as $signal_row
  }

  response = {
    success  : true
    tech_id  : $input.tech_id
    signal_id: $signal_row.id
  }

  guid = "suspend-tech-v1"
}