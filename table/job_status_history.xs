// Tracks the historical changes in job statuses.
table job_status_history {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // Identifier for the associated service job.
    int job_id?
  
    // The status of the job before the change.
    text old_status? filters=trim
  
    // The new status of the job after the change.
    text new_status? filters=trim
  
    // The reason provided for the status change.
    text change_reason? filters=trim
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "XbdHGqrt5CX5NlD9e8sLTDCRflY"
}