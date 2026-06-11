//  Office manual status override. Danielle has the final say on a job's state
//  (like the tech has final say on the TDR). This force-sets scheduling_status
//  directly — it deliberately bypasses the transition-state machine so the
//  office can always correct a job no matter how the automation labelled it
//  (e.g., pull a stuck "broadcasting" job back to "not_ready", mark a
//  SquareTrade job "needs_more_info" until accepted, hold/cancel/complete).
//
//  Only guard: the target must be a known scheduling_status enum value, so the
//  write never bounces with "not an allowable value". Writes an audit row.
query office_set_job_status verb=POST {
  api_group = "intake"

  input {
    int job_id
    text scheduling_status
    text? actor?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }

    var $st { value = (($input.scheduling_status ?? "")|trim|to_lower) }
    var $valid {
      value = ($st == "not_ready" || $st == "needs_more_info" || $st == "prediagnosis_pending" || $st == "intake_complete" || $st == "broadcasting" || $st == "scheduled" || $st == "awaiting_parts" || $st == "held" || $st == "in_progress" || $st == "escalated" || $st == "completed" || $st == "no_fix_possible" || $st == "canceled")
    }
    precondition ($valid == true) {
      error_type = "inputerror"
      error = "unknown status"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "job not found"
    }

    var $prev { value = (($job.scheduling_status ?? "")|to_lower) }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = { scheduling_status: $st }
    }

    db.add event_log {
      data = {
        action  : "office_set_job_status"
        metadata: {
          job_id : $input.job_id
          from   : $prev
          to     : $st
          actor  : (($input.actor ?? "office")|trim)
        }
      }
    } as $log
  }

  response = {
    success           : true
    job_id            : $input.job_id
    scheduling_status : $st
    previous          : $prev
  }

  guid = "office-set-job-status-v1"
}
