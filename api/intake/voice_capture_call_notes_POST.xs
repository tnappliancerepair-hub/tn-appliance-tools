// Called by Ant Inbound near end-of-call to dump anything learned during
// the conversation that should be visible to office + tech without anyone
// listening to the recording. Captures:
//   - additional notes the agent gathered
//   - appliance brand / model / serial if the customer mentioned them
//   - access notes (gate code, pets, side door, etc.)
//   - parts intel (e.g., "they already know it's the inverter")
//
// Writes to event_log as a structured row AND patches job fields that
// are still empty (won't overwrite human input).
query voice_capture_call_notes verb=POST {
  api_group = "intake"

  input {
    int job_id
    text? brand?
    text? model_number?
    text? serial_number?
    text? access_notes?
    text? additional_notes?
    text? parts_intel?
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

    // Only fill blank fields — never overwrite human-supplied values
    var $brand_existing { value = (($job.brand ?? "")|trim) }
    var $model_existing { value = (($job.model_number ?? "")|trim) }
    var $serial_existing { value = (($job.serial_number ?? "")|trim) }
    var $access_existing { value = (($job.access_notes ?? "")|trim) }

    var $new_brand { value = $brand_existing }
    conditional {
      if ($brand_existing == "" && (($input.brand ?? "")|trim) != "") {
        var.update $new_brand { value = (($input.brand ?? "")|trim) }
      }
    }

    var $new_model { value = $model_existing }
    conditional {
      if ($model_existing == "" && (($input.model_number ?? "")|trim) != "") {
        var.update $new_model { value = (($input.model_number ?? "")|trim) }
      }
    }

    var $new_serial { value = $serial_existing }
    conditional {
      if ($serial_existing == "" && (($input.serial_number ?? "")|trim) != "") {
        var.update $new_serial { value = (($input.serial_number ?? "")|trim) }
      }
    }

    var $new_access { value = $access_existing }
    conditional {
      if ($access_existing == "" && (($input.access_notes ?? "")|trim) != "") {
        var.update $new_access { value = (($input.access_notes ?? "")|trim) }
      }
    }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        brand        : $new_brand
        model_number : $new_model
        serial_number: $new_serial
        access_notes : $new_access
      }
    }

    db.add event_log {
      data = {
        action  : "voice_call_notes_captured"
        metadata: ({job_id: $input.job_id, brand: $new_brand, model_number: $new_model, serial_number: $new_serial, access_notes: $new_access, additional_notes: ($input.additional_notes ?? ""), parts_intel: ($input.parts_intel ?? ""), captured_by: "voice_unified_ant", ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success     : true
    job_id      : $input.job_id
    fields_updated: {
      brand        : $new_brand
      model_number : $new_model
      serial_number: $new_serial
      access_notes : $new_access
    }
    captured_at_ms: (now|to_ms)
  }

  guid = "voice-capture-call-notes-v1"
}
