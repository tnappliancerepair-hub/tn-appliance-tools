// Retrieve job events for a specific job ID
query get_job_events verb=GET {
  api_group = "jobs"

  input {
    // Job ID to filter events by
    int id
  }

  stack {
    // Fetch job events for the given job ID
    db.query job_event {
      where = $db.job_event.job_id == $input.id
      return = {type: "list"}
    } as $events
  }

  response = $events
  guid = "sIM-ZLI8Mb_sEI9JckFj6-QX2ZY"
}