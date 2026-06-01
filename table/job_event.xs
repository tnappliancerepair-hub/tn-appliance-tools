// Tracks timeline events and workflow history for each job.
table job_event {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // Identifier for the associated job.
    int job_id?
  
    // Type of event (e.g., 'intake_created', 'payment_received', 'scheduled').
    text event_type? filters=trim
  
    // Source or origin of the event (e.g., 'form', 'technician', 'system').
    text event_source? filters=trim
  
    // Additional notes or details about the event.
    text event_notes? filters=trim
  
    // The user or system that created the event record.
    text created_by? filters=trim
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "m9jP8nmrhmMI0n6Ew6oZMCuynow"
}