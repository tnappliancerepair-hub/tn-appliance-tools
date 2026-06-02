//  Canonical "parts arrived" rail.
// 
//  Whoever flips a job's parts_status to "arrived" should call this
//  instead of a direct db.edit — it does three things atomically:
//    1. Updates jobs.parts_status = "arrived" (and clears parts_eta_date)
//    2. Writes event_log row action="parts_marked_arrived"
//    3. Emits PARTS_ARRIVED colony_signal so the
//       parts_arrived_quick_schedule.js agent fires (tech SMS) and
//       future automations can chain off the same signal.
// 
//  Callers today:
//    - Danielle marks parts arrived from /needs-scheduled or warranty-review
//    - Future: Marcone / Tribles Appliance Parts parts-tracking integrations
// 
//  Idempotent — if parts_status is already "arrived", we skip the
//  status write but STILL emit the signal so downstream agents can
//  react to repeated triggers (with their own dedup).
query mark_parts_arrived verb=POST {
  api_group = "intake"

  input {
    int job_id
    int? marked_by_user_id?
    text? source?
    text? notes?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }
  
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    precondition ($job != null) {
      error_type = "notfound"
      error = "job not found"
    }
  
    var $was_already_arrived {
      value = (($job.parts_status ?? "") == "arrived")
    }
  
    conditional {
      if (!$was_already_arrived) {
        db.edit jobs {
          field_name = "id"
          field_value = $input.job_id
          data = {parts_status: "arrived", parts_eta_date: null}
        } as $updated
      }
    }
  
    var $event_meta {
      value = {
        job_id           : $input.job_id
        tech_id          : ($job.technician_id ?? 0)
        was_already      : $was_already_arrived
        marked_by_user_id: ($input.marked_by_user_id ?? 0)
        source           : ($input.source ?? "")
        notes            : ($input.notes ?? "")
        recorded_at_ms   : now|to_ms
      }
    }
  
    db.add event_log {
      data = {
        action  : "parts_marked_arrived"
        metadata: $event_meta|json_encode
      }
    } as $audit
  
    var $signal_payload {
      value = {
        job_id : $input.job_id
        tech_id: ($job.technician_id ?? 0)
        source : ($input.source ?? "manual")
      }
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "PARTS_ARRIVED"
        signal_strength: 60
        source_colony  : "intake"
        target_colonies: ""
        payload        : $signal_payload|json_encode
      }
    } as $signal
  }

  response = {
    success            : true
    job_id             : $input.job_id
    was_already_arrived: $was_already_arrived
    event_log_id       : $audit.id
    signal_id          : $signal.id
  }

  guid = "mark-parts-arrived-v1"
}