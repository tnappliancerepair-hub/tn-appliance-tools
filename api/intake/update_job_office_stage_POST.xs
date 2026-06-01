// Updates jobs.office_stage. Called from office-tn.html's per-card stage
// dropdown. Validates against the known enum to prevent typos. Empty string
// clears the stage (moves out of all buckets).
query update_job_office_stage verb=POST {
  api_group = "intake"

  input {
    int job_id
    text office_stage
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
  
    // Normalize stage value (?? in value = ... is serializer-safe).
    var $trimmed_stage {
      value = (($input.office_stage ?? "")|trim)
    }
  
    // Validate against known stages. Empty = clear (move out of bucket).
    var $valid_stage {
      value = false
    }
  
    conditional {
      if ($trimmed_stage == "" || $trimmed_stage == "scheduled" || $trimmed_stage == "report" || $trimmed_stage == "upgrade" || $trimmed_stage == "waiting_auth" || $trimmed_stage == "completion_appt" || $trimmed_stage == "follow_up" || $trimmed_stage == "needs_invoicing") {
        var.update $valid_stage {
          value = true
        }
      }
    }
  
    conditional {
      if ($valid_stage == false) {
        return {
          value = {success: false, error: "invalid office_stage value"}
        }
      }
    }
  
    var $prior_stage {
      value = ($job.office_stage ?? "")
    }
  
    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {office_stage: $trimmed_stage}
    } as $updated
  
    db.add event_log {
      data = {
        action  : "office_stage_changed"
        metadata: {
        job_id     : $input.job_id
        prior_stage: $prior_stage
        new_stage  : $trimmed_stage
      }
      }
    } as $log
  }

  response = {success: true, office_stage: $trimmed_stage}
  guid = "aDH3lHCrn_An8I4rCyGaMJVAxzQ"
}