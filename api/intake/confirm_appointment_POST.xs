// CSC-side tool — call this when the customer affirms during the 24h
// appointment reminder outbound call. Logs the confirmation to
// event_log so downstream agents (no-show watch, day-of dispatcher)
// know it's a confirmed appointment.
query confirm_appointment verb=POST {
  api_group = "intake"

  input {
    int job_id
    text? confirmed_via?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id is required"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }

    var $via {
      value = (($input.confirmed_via ?? "voice_appointment_reminder")|trim)
    }

    db.add event_log {
      data = {
        action  : "appointment_confirmed_by_customer"
        metadata: ({job_id: $input.job_id, customer_id: ($job.customer_id ?? 0), via: $via, ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success: true
    job_id : $input.job_id
    confirmed_at_ms: (now|to_ms)
    via    : $via
  }

  guid = "confirm-appointment-v1"
}
