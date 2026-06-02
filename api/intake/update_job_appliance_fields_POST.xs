// Updates the appliance fields on a job (model_number / brand / serial /
// appliance_type). Used by Teddy Tool's inline-edit UX when the field is
// missing or wrong. Each call writes an audit row so we can trace who
// changed what.
query update_job_appliance_fields verb=POST {
  api_group = "intake"

  input {
    int job_id
    text? model_number?
    text? brand?
    text? serial_number?
    text? appliance_type?
    text? updated_by?
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
      error = "Job not found"
    }

    // Only set fields that were explicitly passed in. Empty-string
    // values DO write (lets you clear a field) but null/missing skips.
    var $model_in  { value = ($input.model_number ?? "__SKIP__") }
    var $brand_in  { value = ($input.brand ?? "__SKIP__") }
    var $serial_in { value = ($input.serial_number ?? "__SKIP__") }
    var $appl_in   { value = ($input.appliance_type ?? "__SKIP__") }

    var $new_model  { value = ($model_in == "__SKIP__") ? ($job.model_number ?? "") : ($model_in|trim) }
    var $new_brand  { value = ($brand_in == "__SKIP__") ? ($job.brand ?? "") : ($brand_in|trim) }
    var $new_serial { value = ($serial_in == "__SKIP__") ? ($job.serial_number ?? "") : ($serial_in|trim) }
    var $new_appl   { value = ($appl_in == "__SKIP__") ? ($job.appliance_type ?? "") : ($appl_in|trim) }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        model_number   : $new_model
        brand          : $new_brand
        serial_number  : $new_serial
        appliance_type : $new_appl
      }
    } as $updated

    db.add event_log {
      data = {
        action    : "job_appliance_fields_updated"
        metadata  : {
          job_id            : $input.job_id
          model_number      : $new_model
          brand             : $new_brand
          serial_number     : $new_serial
          appliance_type    : $new_appl
          updated_by        : (($input.updated_by ?? "office")|trim)
          prior_model       : ($job.model_number ?? "")
          prior_brand       : ($job.brand ?? "")
        }
      }
    } as $audit
  }

  response = {
    success        : true
    job_id         : $input.job_id
    model_number   : $new_model
    brand          : $new_brand
    serial_number  : $new_serial
    appliance_type : $new_appl
    audit_event_id : $audit.id
  }

  guid = "update-job-appliance-fields-v1"
}
