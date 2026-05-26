// Dedup query for the appointment_scheduled agent. Returns true when the
// agent has already sent a customer confirmation for this exact
// (job_id, scheduled_start_ms) pair. Reschedules to a new time get a fresh
// confirmation; no-op edits to the same time skip cleanly.
query get_appointment_confirmation_sent verb=GET {
  api_group = "intake"

  input {
    int job_id
    int scheduled_start_ms
  }

  stack {
    db.query event_log {
      where = $db.event_log.action == "appointment_confirmation_sent" && $db.event_log.metadata.job_id == $input.job_id && $db.event_log.metadata.scheduled_start_ms == $input.scheduled_start_ms
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $first {
      value = (($rows.items|first) ?? null)
    }

    var $sent_flag {
      value = ($first != null)
    }

    var $last_at {
      value = ($first.created_at ?? null)
    }
  }

  response = {
    success     : true
    sent        : $sent_flag
    last_sent_at: $last_at
  }

  guid = "get-appointment-confirmation-sent-v1"
}
