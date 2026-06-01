query book_appointment verb=POST {
  api_group = "intake"

  input {
    int job_id {
      table = "jobs"
    }
  
    text preferred_date
    text preferred_time
    text service_eta_window
    text service_address?
    text service_city?
    text service_state?
    text service_zip?
    text notes?
  }

  stack {
    var $availability {
      value = $input.preferred_date ~ " " ~ $input.preferred_time
    }
  
    var $scheduled_ts {
      value = $availability|to_timestamp
    }
  
    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        scheduling_status : "booked"
        scheduled_start   : $scheduled_ts
        service_eta_window: $input.service_eta_window
        availability_one  : $availability
        notes_internal    : $input.notes
        service_address   : $input.service_address
        service_city      : $input.service_city
        service_state     : $input.service_state
        service_zip       : $input.service_zip
      }
    } as $updated_job
  
    precondition ($updated_job != null) {
      error_type = "notfound"
      error = "Job not found"
    }
  
    db.add job_event {
      data = {
        job_id      : $input.job_id
        event_type  : "appointment_booked"
        event_notes : ($availability ~ " | " ~ $input.service_eta_window ~ " | " ~ $input.service_address)
        event_source: "intake"
        created_by  : "customer"
      }
    } as $event
  }

  response = $updated_job
  guid = "UudmfJlKc9yWna1nLGELTzxwFN0"
}