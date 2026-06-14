//  Lets the office clear a job off the Needs Scheduled list two ways, per
//  Danielle's request:
//    action = "delete"   -> junk / canceled-email intake. Sets scheduling_status
//                           = "canceled" so it drops off the list. SOFT remove
//                           (row kept for audit + FK safety), silent (does NOT
//                           fire the JOB_CANCELED customer-SMS chain -- these
//                           are not real customers expecting service).
//    action = "complete" -> job already handled/done elsewhere. Sets status
//                           "completed" silently (does NOT fire JOB_COMPLETED /
//                           warranty digest -- that only fires from the tech
//                           complete endpoint).
//  Either way the needs-scheduled query (non-terminal statuses) stops showing it.
//
//  No office password (page already gated; mirrors office_quick_fill).
//  XS rules: no em-dashes, no try/catch, data = { } for db.edit, ?? + |trim
//  only in value = (...), conditional blocks (no else-if chains needed here).
query office_remove_job verb=POST {
  api_group = "intake"

  input {
    int job_id
    text action
    text? reason?
    text? actor?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }

    var $act {
      value = (($input.action ?? "")|trim|lower)
    }

    precondition ($act == "delete" || $act == "complete") {
      error_type = "inputerror"
      error = "action must be delete or complete"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "job not found"
    }

    var $new_status {
      value = ($act == "delete" ? "canceled" : "completed")
    }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        scheduling_status : $new_status
        current_status    : $new_status
      }
    }

    db.add event_log {
      data = {
        action  : "office_remove_job"
        metadata : {
          job_id     : $input.job_id
          remove_as  : $act
          new_status : $new_status
          reason     : (($input.reason ?? "")|trim)
          actor      : (($input.actor ?? "office")|trim)
        }
      }
    } as $log
  }

  response = {
    success    : true
    job_id     : $input.job_id
    action     : $act
    new_status : $new_status
  }

  guid = "office-remove-job-v1"
}
