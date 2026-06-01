//  Updates a customer's most-recent not_ready parallel-mode job with the
//  time preference they SMS'd back ("M"/"A"/etc) and advances the job's
//  scheduling_status from "not_ready" to "intake_complete" so the
//  auto-scheduler picks it up next pass.
// 
//  Used by the sms_response_time_preference agent after a stuck-intake
//  nudge gets answered.
query apply_time_preference verb=POST {
  api_group = "intake"

  input {
    int customer_id
    text preference_text
    text? raw_reply?
  }

  stack {
    precondition ($input.customer_id > 0) {
      error_type = "inputerror"
      error = "customer_id required"
    }
  
    var $pref_clean {
      value = (($input.preference_text ?? "")|trim)
    }
  
    precondition ($pref_clean != "") {
      error_type = "inputerror"
      error = "preference_text required"
    }
  
    // Find this customer's most recent not_ready parallel-mode job
    db.query jobs {
      where = $db.jobs.customer_id == $input.customer_id && $db.jobs.scheduling_status == "not_ready" && $db.jobs.parallel_mode == true
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $job_rows
  
    var $job {
      value = (($job_rows.items|first) ?? null)
    }
  
    precondition ($job != null) {
      error_type = "notfound"
      error = "no open not_ready job for this customer"
    }
  
    var $existing_pref {
      value = (($job.customer_preference_text ?? "")|trim)
    }
  
    var $merged_pref {
      value = ($existing_pref != "") ? ($existing_pref ~ " | " ~ $pref_clean) : $pref_clean
    }
  
    db.edit jobs {
      field_name = "id"
      field_value = $job.id
      data = {
        customer_preference_text: $merged_pref
        scheduling_status       : "intake_complete"
      }
    } as $updated
  
    db.add event_log {
      data = {
        action  : "time_preference_applied"
        metadata: {
        job_id         : $job.id
        customer_id    : $input.customer_id
        preference_text: $pref_clean
        raw_reply      : (($input.raw_reply ?? "")|trim)
        new_status     : "intake_complete"
      }
      }
    } as $audit
  }

  response = {
    success   : true
    job_id    : $job.id
    new_status: "intake_complete"
    preference: $merged_pref
  }

  guid = "apply-time-preference-v1"
}