//  Persist a job's office-board placement on the job record (jobs.office_stage)
//  so a card STAYS where Danielle drops it — across devices and reloads, not
//  just in one browser's localStorage. Optionally moves the job's region
//  (service_state) so a NOLA job dragged out of the TN folder sticks in NOLA.
//  No auth (office-only, same as the other board endpoints).
//
//  XS rules: no em-dashes, no backticks, data = { } for db.edit.
query office_set_stage verb=POST {
  api_group = "intake"

  input {
    int job_id
    text stage
    text? service_state?
    text? actor?
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

    var $stage_v {
      value = (($input.stage ?? "")|trim)
    }
    var $state_in {
      value = (($input.service_state ?? "")|trim|to_upper)
    }
    var $new_state {
      value = ($state_in != "" ? $state_in : ($job.service_state ?? ""))
    }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        office_stage  : $stage_v
        service_state : $new_state
      }
    }

    db.add event_log {
      data = {
        action  : "office_stage_set"
        metadata: {
          job_id        : $input.job_id
          stage         : $stage_v
          service_state : $new_state
          actor         : (($input.actor ?? "office")|trim)
        }
      }
    } as $log
  }

  response = {
    success       : true
    job_id        : $input.job_id
    office_stage  : $stage_v
    service_state : $new_state
  }

  guid = "office-set-stage-v1"
}
