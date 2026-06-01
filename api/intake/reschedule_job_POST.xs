// Reschedules a job. Called by the office Reschedule modal in job-detail.html.
// Sets scheduled_start to new_start_ms (unix ms) and flips scheduling_status
// to "scheduled". Audit-logs prior values.
query reschedule_job verb=POST {
  api_group = "intake"

  input {
    int job_id
    int new_start_ms
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    conditional {
      if ($job == null) {
        return {
          value = {success: false, error: "job not found"}
        }
      }
    }
  
    var $prior_start {
      value = $job.scheduled_start
    }
  
    var $prior_status {
      value = $job.scheduling_status
    }
  
    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        scheduled_start  : $input.new_start_ms
        scheduling_status: "scheduled"
      }
    } as $updated
  
    db.add event_log {
      data = {
        action  : "job_rescheduled"
        metadata: {
        job_id      : $input.job_id
        prior_start : $prior_start
        new_start   : $input.new_start_ms
        prior_status: $prior_status
      }
      }
    } as $log
  
    // Phase 5.5C: emit APPOINTMENT_SCHEDULED for customer + tech confirmation SMS.
    var $as_resched_endpoint_obj {
      value = {
        job_id            : $input.job_id
        scheduled_start_ms: $input.new_start_ms
        scheduled_end_ms  : null
        technician_id     : ($job.technician_id ?? 0)
        source            : "reschedule_endpoint"
      }
    }
  
    var $as_resched_endpoint_str {
      value = $as_resched_endpoint_obj|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "APPOINTMENT_SCHEDULED"
        signal_strength: 60
        source_colony  : ""
        target_colonies: ""
        payload        : $as_resched_endpoint_str
      }
    } as $as_resched_endpoint_signal
  
    db.add event_log {
      data = {
        action  : "appointment_scheduled_signal_emitted"
        metadata: {
        job_id            : $input.job_id
        signal_id         : $as_resched_endpoint_signal.id
        scheduled_start_ms: $input.new_start_ms
        source            : "reschedule_endpoint"
      }
      }
    } as $as_resched_endpoint_log
  }

  response = {success: true, new_start: $input.new_start_ms}
  guid = "6AcIjClybPWVn26loZ4InjUquSk"
}