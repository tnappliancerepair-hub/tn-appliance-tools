query unassign_technician verb=PATCH {
  api_group = "jobs"
  auth = "user"

  input {
    // The ID of the job to unassign the technician from
    int id
  }

  stack {
    // Update the job to remove the technician and reset scheduling status
    db.edit jobs {
      field_name = "id"
      field_value = $input.id
      data = {technician_id: null, scheduling_status: "not_ready"}
    } as $updated_job
  }

  response = $updated_job
  guid = "HyfxZT0CtiMrsa5ztaG_8k5-WiE"
}