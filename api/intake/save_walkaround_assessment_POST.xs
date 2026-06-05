// Stores a Claude Vision walkaround baseline assessment for a job.
// Writes an event_log row that can be retrieved later if a customer
// disputes pre-existing damage / condition. Defensive documentation.
query save_walkaround_assessment verb=POST {
  api_group = "intake"

  input {
    int   job_id
    int?  technician_id?
    text? purpose?
    text  assessment_text
    text? damage_noted?
    text? cleanliness?
    text? notable_items?
    text? confidence?
    int?  attachment_id?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }
    var $assessment_clean { value = ($input.assessment_text ?? "")|trim }
    precondition ($assessment_clean != "") {
      error_type = "inputerror"
      error = "assessment_text required"
    }

    var $tech_id { value = ($input.technician_id ?? 0) }
    var $purpose_clean { value = (($input.purpose ?? "walkaround_initial")|trim) }
    var $damage_clean { value = (($input.damage_noted ?? "")|trim) }
    var $cleanliness_clean { value = (($input.cleanliness ?? "unknown")|trim) }
    var $items_clean { value = (($input.notable_items ?? "")|trim) }
    var $conf_clean { value = (($input.confidence ?? "medium")|trim) }
    var $att_id { value = ($input.attachment_id ?? 0) }

    db.add event_log {
      data = {
        action  : "walkaround_assessment_captured"
        metadata: ({job_id: $input.job_id, technician_id: $tech_id, purpose: $purpose_clean, assessment_text: $assessment_clean, damage_noted: $damage_clean, cleanliness: $cleanliness_clean, notable_items: $items_clean, confidence: $conf_clean, attachment_id: $att_id, ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success: true
    job_id : $input.job_id
    purpose: $purpose_clean
  }

  guid = "save-walkaround-assessment-v1"
}
