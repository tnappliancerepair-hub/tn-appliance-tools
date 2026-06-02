// Office-side dismiss button. Sets scheduling_status to "canceled" with
// a "Dismissed by office" friendly_status + audit row, so the job
// disappears from needs-scheduled / stuck_intake / email_intake queues
// but stays in the DB for audit + future undo.
//
// Used for clearing status-update emails (noise) Danielle doesn't want
// in her active queue.
query dismiss_job verb=POST {
  api_group = "intake"

  input {
    int job_id
    text office_password
    text? reason?
  }

  stack {
    var $env_pw {
      value = (($env.OFFICE_PASSWORD ?? "antlives")|trim)
    }

    var $supplied_pw {
      value = (($input.office_password ?? "")|trim)
    }

    conditional {
      if ($env_pw == "" || $env_pw != $supplied_pw) {
        return {
          value = { success: false, error: "unauthorized" }
        }
      }
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    conditional {
      if ($job == null) {
        return {
          value = { success: false, error: "job_not_found" }
        }
      }
    }

    var $reason_txt {
      value = (($input.reason|to_text) ?? "Dismissed by office")
    }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        scheduling_status: "canceled"
        friendly_status  : $reason_txt
      }
    }

    db.add event_log {
      data = {
        action  : "job_dismissed_by_office"
        metadata: ```
          {
            job_id: $input.job_id
            reason: $reason_txt
            prior_status: (($job.scheduling_status|to_text) ?? "")
          }|json_encode
          ```
      }
    }
  }

  response = {
    success: true
    job_id : $input.job_id
  }

  guid = "dismiss-job-v1"
}
