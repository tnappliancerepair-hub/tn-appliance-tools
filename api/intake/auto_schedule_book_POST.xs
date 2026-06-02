// Books a scheduled slot decided by the auto-schedule matcher.
// Inputs: job_id + tech_id + scheduled_start (ISO or ms).
// Sets technician_id + scheduled_start + scheduling_status=scheduled,
// emits APPOINTMENT_SCHEDULED (existing confirmation chain handles the
// customer + tech SMS).
query auto_schedule_book verb=POST {
  api_group = "intake"

  input {
    int job_id
    int technician_id
    int scheduled_start_ms
    text? matched_block?
  }

  stack {
    precondition ($input.job_id > 0 && $input.technician_id > 0 && $input.scheduled_start_ms > 0) {
      error_type = "inputerror"
      error      = "job_id + technician_id + scheduled_start_ms required"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    conditional {
      if ($job == null) {
        return { value = { success: false, error: "job_not_found" } }
      }
    }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        technician_id     : $input.technician_id
        scheduled_start   : $input.scheduled_start_ms
        scheduling_status : "scheduled"
        friendly_status   : "Auto-scheduled by Ant"
      }
    }

    var $payload_str {
      value = ```
        {
          job_id          : $input.job_id
          customer_id     : ($job.customer_id ?? 0)
          technician_id   : $input.technician_id
          scheduled_start_ms: $input.scheduled_start_ms
          prior_status    : (($job.scheduling_status|to_text) ?? "")
          source          : "auto_schedule_from_availability"
          matched_block   : (($input.matched_block|to_text) ?? "")
        }|json_encode
        ```
    }

    db.add colony_signals {
      data = {
        signal_type    : "APPOINTMENT_SCHEDULED"
        signal_strength: 80
        source_colony  : "auto_scheduler"
        target_colonies: ""
        payload        : $payload_str
      }
    }

    db.add event_log {
      data = {
        action  : "auto_scheduled_by_ant"
        metadata: ```
          {
            job_id            : $input.job_id
            technician_id     : $input.technician_id
            scheduled_start_ms: $input.scheduled_start_ms
            matched_block     : (($input.matched_block|to_text) ?? "")
          }|json_encode
          ```
      }
    }
  }

  response = {
    success          : true
    job_id           : $input.job_id
    technician_id    : $input.technician_id
    scheduled_start_ms: $input.scheduled_start_ms
  }

  guid = "auto-schedule-book-v1"
}
