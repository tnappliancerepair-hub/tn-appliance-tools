// Returns the parts status and associated part orders for a specific job.
query get_parts_status verb=GET {
  api_group = "intake"

  input {
    // The ID of the job to check.
    // The ID of the job
    int job_id {
      table = "jobs"
    }
  }

  stack {
    // Get the job record to extract parts_status and part_eta.
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    // Ensure the job exists.
    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }
  
    // Query all part order records linked to this job.
    db.query part_order {
      where = $db.part_order.job_id == $input.job_id
      return = {type: "list"}
    } as $part_orders
  }

  response = {
    parts_status: $job.parts_status
    part_eta    : $job.part_eta
    part_orders : $part_orders
  }

  guid = "owgC3gJg1kk0p1IM7zypz6qVDNw"
}