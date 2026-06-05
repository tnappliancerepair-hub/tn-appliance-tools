// Writes a model number extracted from a photo by Claude Vision OCR.
// Conservative: only updates fields that are currently empty so the
// vision pass never overwrites manual entry by the tech or office.
// Writes an audit row to event_log with confidence + source image.
query update_job_model_from_ocr verb=POST {
  api_group = "intake"

  input {
    int   job_id
    text  model_number
    text? serial_number?
    text? manufacturer?
    text? appliance_type?
    text? confidence?
    text? image_url?
  }

  stack {
    var $model_clean { value = ($input.model_number ?? "")|trim }
    precondition ($model_clean != "") {
      error_type = "inputerror"
      error = "model_number required"
    }
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

    // Only fill empty fields — never overwrite human entry.
    var $existing_model { value = (($job.model_number ?? "")|trim) }
    var $existing_serial { value = (($job.serial_number ?? "")|trim) }
    var $existing_brand { value = (($job.appliance_brand ?? "")|trim) }
    var $existing_type { value = (($job.appliance_type ?? "")|trim) }

    var $serial_clean { value = ($input.serial_number ?? "")|trim }
    var $brand_clean { value = ($input.manufacturer ?? "")|trim }
    var $type_clean { value = ($input.appliance_type ?? "")|trim }

    var $write_model { value = ($existing_model == "") }
    var $write_serial { value = ($existing_serial == "" && $serial_clean != "") }
    var $write_brand { value = ($existing_brand == "" && $brand_clean != "") }
    var $write_type { value = ($existing_type == "" && $type_clean != "") }

    var $new_model { value = ($write_model == true) ? $model_clean : $existing_model }
    var $new_serial { value = ($write_serial == true) ? $serial_clean : $existing_serial }
    var $new_brand { value = ($write_brand == true) ? $brand_clean : $existing_brand }
    var $new_type { value = ($write_type == true) ? $type_clean : $existing_type }

    conditional {
      if ($write_model == true || $write_serial == true || $write_brand == true || $write_type == true) {
        db.edit jobs {
          field_name = "id"
          field_value = $input.job_id
          data = {
            model_number: $new_model
            serial_number: $new_serial
            appliance_brand: $new_brand
            appliance_type: $new_type
          }
        }
      }
    }

    db.add event_log {
      data = {
        action  : "model_extracted_from_photo"
        metadata: ({job_id: $input.job_id, model: $model_clean, serial: $serial_clean, brand: $brand_clean, type: $type_clean, confidence: ($input.confidence ?? "unknown"), wrote_model: $write_model, image_url: ($input.image_url ?? ""), ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success: true
    job_id : $input.job_id
    wrote  : $write_model
    model_already_set: ($existing_model != "")
    final_model: $new_model
  }

  guid = "update-job-model-from-ocr-v1"
}
