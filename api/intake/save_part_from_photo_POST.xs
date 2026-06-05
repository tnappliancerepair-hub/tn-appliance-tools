// Append a part number extracted from a photo by Claude Vision to the
// TDR's parts_needed field. Dedupes — if the same part_number is
// already listed, no-op. Never overwrites the tech's existing entries;
// only adds.
//
// Also writes an event_log audit row with confidence + source image
// for future review / training the parts catalog.
query save_part_from_photo verb=POST {
  api_group = "intake"

  input {
    int   job_id
    int?  technician_id?
    text  part_number
    text? part_description?
    text? manufacturer?
    text? confidence?
    text? image_url?
    int?  attachment_id?
  }

  stack {
    var $part_clean { value = ($input.part_number ?? "")|upper|trim }
    precondition ($part_clean != "") {
      error_type = "inputerror"
      error = "part_number required"
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

    var $tech_id {
      value = ($input.technician_id ?? ($job.technician_id ?? 0))
    }
    var $desc_clean { value = ($input.part_description ?? "")|trim }
    var $brand_clean { value = ($input.manufacturer ?? "")|trim }
    var $conf { value = ($input.confidence ?? "medium")|trim }

    // Find most-recent TDR for this job + tech (we'll append parts to
    // this row; create one if it doesn't exist).
    db.query technician_decision_report {
      where = $db.technician_decision_report.job_id == $input.job_id && $db.technician_decision_report.technician_id == $tech_id
      sort  = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $tdr_rows

    var $existing {
      value = (($tdr_rows.items|first) ?? null)
    }
    var $existing_parts {
      value = ($existing == null) ? "" : (($existing.parts_needed ?? "")|to_text)
    }
    var $existing_id {
      value = ($existing == null) ? 0 : $existing.id
    }

    // Build a display label like "8540101 (drive belt - Whirlpool)"
    // when extras present; just the part number when alone.
    var $label_with_desc {
      value = ($desc_clean != "") ? ($part_clean ~ " (" ~ $desc_clean ~ ")") : $part_clean
    }
    var $label {
      value = ($brand_clean != "") ? ($label_with_desc ~ " - " ~ $brand_clean) : $label_with_desc
    }

    // Dedup — skip if the part number already appears in parts_needed.
    var $already_present {
      value = (($existing_parts|contains:$part_clean) == true)
    }
    var $new_parts {
      value = ($existing_parts == "") ? $label : ($existing_parts ~ ", " ~ $label)
    }

    // Create new TDR row if none exists; otherwise edit existing.
    conditional {
      if ($existing == null && $already_present == false) {
        db.add technician_decision_report {
          data = {
            job_id          : $input.job_id
            technician_id   : $tech_id
            source          : "ant_field_assist_vision"
            parts_needed    : $label
          }
        } as $created
        var.update $existing_id { value = $created.id }
      }
    }
    conditional {
      if ($existing != null && $already_present == false) {
        db.edit technician_decision_report {
          field_name = "id"
          field_value = $existing_id
          data = {parts_needed: $new_parts}
        }
      }
    }

    db.add event_log {
      data = {
        action  : "part_extracted_from_photo"
        metadata: ({job_id: $input.job_id, technician_id: $tech_id, part_number: $part_clean, description: $desc_clean, brand: $brand_clean, confidence: $conf, already_present: $already_present, tdr_id: $existing_id, image_url: ($input.image_url ?? ""), attachment_id: ($input.attachment_id ?? 0), ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success: true
    job_id : $input.job_id
    tdr_id : $existing_id
    part   : $part_clean
    wrote  : ($already_present == false)
    already_present: $already_present
  }

  guid = "save-part-from-photo-v1"
}
