// Danielle hits this from needs-scheduled.html when she assigns a tech +
// time to a parallel-mode job. Writes scheduled_start + technician_id +
// flips scheduling_status to "scheduled". Logs the action. No SMS to
// tech yet (Phase 1: Danielle communicates with techs through her
// normal channels).
query danielle_schedule_parallel_job verb=POST {
  api_group = "intake"

  input {
    int job_id
    int technician_id
    int scheduled_start_ms
    int? scheduled_end_ms?
    text? service_eta_window?
  }

  stack {
    precondition ($input.job_id > 0 && $input.technician_id > 0 && $input.scheduled_start_ms > 0) {
      error_type = "inputerror"
      error      = "job_id, technician_id, scheduled_start_ms required"
    }

    db.get jobs {
      field_name  = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error      = "Job not found"
    }

    var $prior_tech { value = ($job.technician_id ?? 0) }
    var $prior_start { value = ($job.scheduled_start ?? null) }

    var $end_ms {
      value = (($input.scheduled_end_ms ?? 0) > 0) ? $input.scheduled_end_ms : ($input.scheduled_start_ms + 7200000)
    }

    db.edit jobs {
      field_name  = "id"
      field_value = $input.job_id
      data        = {
        technician_id      : $input.technician_id
        scheduled_start    : $input.scheduled_start_ms
        scheduled_end      : $end_ms
        service_eta_window : (($input.service_eta_window ?? "")|trim)
        scheduling_status  : "scheduled"
        current_status     : "scheduled"
      }
    } as $updated_job

    db.add event_log {
      data = {
        action  : "danielle_scheduled_parallel_job"
        metadata: {
          job_id            : $input.job_id
          prior_technician  : $prior_tech
          new_technician    : $input.technician_id
          prior_start       : $prior_start
          new_start_ms      : $input.scheduled_start_ms
          end_ms            : $end_ms
        }
      }
    } as $audit
  }

  response = {
    success            : true
    job_id             : $input.job_id
    technician_id      : $input.technician_id
    scheduled_start_ms : $input.scheduled_start_ms
  }

  guid = "danielle-schedule-parallel-job-v1"
}
