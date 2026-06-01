query assign_technician verb=PATCH {
  api_group = "jobs"
  auth = "user"

  input {
    // The ID of the job to update (path parameter)
    int id
  
    // The ID of the technician to assign
    int technician_id
  }

  stack {
    // Update the job record with the assigned technician and new scheduling status
    db.edit jobs {
      field_name = "id"
      field_value = $input.id
      data = {
        technician_id    : $input.technician_id
        scheduling_status: "scheduled"
      }
    } as $updated_job
  }

  response = $updated_job
  guid = "weLWeFeyQPel_qTXbtDR5NShL0c"
}