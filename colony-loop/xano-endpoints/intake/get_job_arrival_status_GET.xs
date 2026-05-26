// Tiny query for tech_arrival_check agent — returns just the fields it
// needs to know whether the tech has tapped Start Job yet. Avoids pulling
// the full get_job_for_dashboard payload (~10KB) just to read 3 columns.
query get_job_arrival_status verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    db.get jobs {
      field_name  = "id"
      field_value = $input.job_id
    } as $j

    precondition ($j != null) {
      error_type = "notfound"
      error      = "Job not found"
    }
  }

  response = {
    success           : true
    job_id            : $j.id
    job_started_at    : ($j.job_started_at ?? null)
    tech_en_route_at  : ($j.tech_en_route_at ?? null)
    scheduling_status : ($j.scheduling_status ?? "")
    technician_id     : ($j.technician_id ?? null)
    eta_ms            : ($j.eta_ms ?? null)
  }

  guid = "get-job-arrival-status-v1"
}
