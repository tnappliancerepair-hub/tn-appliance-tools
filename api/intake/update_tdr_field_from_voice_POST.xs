// Ant Field Assist tool — writes a single TDR field mid-conversation
// as the tech narrates. Upserts the in-progress TDR by (job_id,
// technician_id, finalized=false). Vapi calls this multiple times per
// call as different fields become clear.
query update_tdr_field_from_voice verb=POST {
  api_group = "intake"

  input {
    int job_id
    text field
    text value
    int? technician_id?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }
    precondition (($input.field ?? "")|trim != "") {
      error_type = "inputerror"
      error = "field required"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }

    var $tech_id {
      value = ($input.technician_id ?? ($job.technician_id ?? 0))
    }
    var $clean_value {
      value = ($input.value ?? "")|trim
    }
    var $field_clean {
      value = $input.field|trim
    }

    // Pre-compute every possible field value (one will get the new
    // value, others will be empty string for the create-path only).
    var $v_diag {
      value = ($field_clean == "diagnosis") ? $clean_value : ""
    }
    var $v_comp {
      value = ($field_clean == "failed_component") ? $clean_value : ""
    }
    var $v_hours {
      value = ($field_clean == "labor_hours") ? $clean_value : ""
    }
    var $v_repair {
      value = ($field_clean == "repair_completed") ? $clean_value : ""
    }
    var $v_parts {
      value = ($field_clean == "parts_needed") ? $clean_value : ""
    }
    var $v_notes {
      value = ($field_clean == "customer_notes") ? $clean_value : ""
    }

    // Find existing in-progress TDR for this job + tech
    db.query technician_decision_report {
      where = $db.technician_decision_report.job_id == $input.job_id && $db.technician_decision_report.technician_id == $tech_id && $db.technician_decision_report.finalized == false
      sort  = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $existing_rows

    var $existing {
      value = (($existing_rows.items|first) ?? null)
    }
    var $existing_id {
      value = ($existing == null) ? 0 : $existing.id
    }

    // Create row if none exists
    conditional {
      if ($existing_id == 0) {
        db.add technician_decision_report {
          data = {
            job_id          : $input.job_id
            technician_id   : $tech_id
            finalized       : false
            source          : "ant_field_assist_voice"
            diagnosis       : $v_diag
            failed_component: $v_comp
            labor_time_hours: $v_hours
            repair_completed: $v_repair
            parts_needed    : $v_parts
            customer_notes  : $v_notes
          }
        } as $created_tdr
        var.update $existing_id { value = $created_tdr.id }
      }
    }

    // Edit row if it existed
    conditional {
      if ($existing != null && $field_clean == "diagnosis") {
        db.edit technician_decision_report {
          field_name = "id"
          field_value = $existing_id
          data = {diagnosis: $clean_value}
        }
      }
    }
    conditional {
      if ($existing != null && $field_clean == "failed_component") {
        db.edit technician_decision_report {
          field_name = "id"
          field_value = $existing_id
          data = {failed_component: $clean_value}
        }
      }
    }
    conditional {
      if ($existing != null && $field_clean == "labor_hours") {
        db.edit technician_decision_report {
          field_name = "id"
          field_value = $existing_id
          data = {labor_time_hours: $clean_value}
        }
      }
    }
    conditional {
      if ($existing != null && $field_clean == "repair_completed") {
        db.edit technician_decision_report {
          field_name = "id"
          field_value = $existing_id
          data = {repair_completed: $clean_value}
        }
      }
    }
    conditional {
      if ($existing != null && $field_clean == "parts_needed") {
        db.edit technician_decision_report {
          field_name = "id"
          field_value = $existing_id
          data = {parts_needed: $clean_value}
        }
      }
    }
    conditional {
      if ($existing != null && $field_clean == "customer_notes") {
        db.edit technician_decision_report {
          field_name = "id"
          field_value = $existing_id
          data = {customer_notes: $clean_value}
        }
      }
    }

    db.add event_log {
      data = {
        action  : "tdr_field_updated_from_voice"
        metadata: ({job_id: $input.job_id, technician_id: $tech_id, field: $field_clean, tdr_id: $existing_id, value_len: ($clean_value|length), ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success: true
    job_id : $input.job_id
    tdr_id : $existing_id
    field  : $field_clean
    ack    : "Locked in."
  }

  guid = "update-tdr-field-from-voice-v1"
}
