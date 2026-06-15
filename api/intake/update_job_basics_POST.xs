//  Write-once job identity fields. The customer's machine info (brand, model,
//  appliance, problem) lives on ONE job record that every surface reads - the
//  tech page, Danielle's board card, the Teddy Tool, the parts finder, the
//  customer portal. So updating it here auto-populates everywhere at once.
//
//  Anyone who catches a correction can call this (no office password): the tech
//  fixes a wrong model in the field, the office corrects a brand, intake seeds
//  the first values. Only non-empty inputs overwrite - blanks leave a field
//  untouched, so a partial update never wipes good data.
//
//  XS rules: no em-dashes, no backticks, no try/catch, data = { } for db.edit.
query update_job_basics verb=POST {
  api_group = "intake"

  input {
    int job_id
    text? brand?
    text? model_number?
    text? appliance_type?
    text? problem_summary?
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

    var $brand        { value = (($input.brand ?? "")|trim) }
    var $model        { value = (($input.model_number ?? "")|trim) }
    var $appliance    { value = (($input.appliance_type ?? "")|trim) }
    var $problem      { value = (($input.problem_summary ?? "")|trim) }

    // Only overwrite a field when a non-empty value was supplied.
    var $new_brand     { value = ($brand != "" ? $brand : ($job.brand ?? "")) }
    var $new_model     { value = ($model != "" ? $model : ($job.model_number ?? "")) }
    var $new_appliance { value = ($appliance != "" ? $appliance : ($job.appliance_type ?? "")) }
    var $new_problem   { value = ($problem != "" ? $problem : ($job.problem_summary ?? "")) }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        brand          : $new_brand
        model_number   : $new_model
        appliance_type : $new_appliance
        problem_summary: $new_problem
      }
    }

    db.add event_log {
      data = {
        action  : "job_basics_updated"
        metadata: {
          job_id        : $input.job_id
          brand         : $new_brand
          model_number  : $new_model
          appliance_type: $new_appliance
          actor         : (($input.actor ?? "office")|trim)
        }
      }
    } as $log

    // Re-fire the parts pre-order predictor when brand or model just got added.
    // At intake, warranty jobs usually lack brand/model, so the JOB_CREATED
    // pre-order skipped on insufficient_signal. Now that we have it, give the
    // predictor another shot so the tech can bring the right part first trip.
    var $has_signal {
      value = ($brand != "" || $model != "")
    }

    var $preorder_payload {
      value = {
        job_id: $input.job_id
        source: "job_basics_updated"
      }
    }

    conditional {
      if ($has_signal) {
        db.add colony_signals {
          data = {
            signal_type    : "PARTS_PRE_ORDER_SUGGESTION"
            signal_strength: 45
            source_colony  : "office_board"
            target_colonies: ""
            payload        : ($preorder_payload|json_encode)
          }
        }
      }
    }
  }

  response = {
    success        : true
    job_id         : $input.job_id
    brand          : $new_brand
    model_number   : $new_model
    appliance_type : $new_appliance
    problem_summary: $new_problem
  }

  guid = "update-job-basics-v1"
}
