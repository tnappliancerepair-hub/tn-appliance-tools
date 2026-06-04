// Polled by tech-ant-chat after a photo upload — returns the
// vision_classification + extracted fields so the tech sees the
// result inline ("Got model: WTW5000DW2" or "Couldn't read it").
query get_attachment_vision_result verb=GET {
  api_group = "intake"

  input {
    int attachment_id
  }

  stack {
    db.get job_attachments {
      field_name = "id"
      field_value = $input.attachment_id
    } as $att

    precondition ($att != null) {
      error_type = "notfound"
      error = "attachment not found"
    }

    var $status_clean { value = ($att.vision_status ?? "pending") }
    var $classification_clean { value = ($att.vision_classification ?? "") }
    var $extracted_clean { value = ($att.vision_extracted ?? "") }
    var $confidence_clean { value = ($att.vision_confidence ?? 0) }
  }

  response = {
    success           : true
    attachment_id     : $att.id
    job_id            : ($att.job_id ?? 0)
    status            : $status_clean
    classification    : $classification_clean
    extracted_json    : $extracted_clean
    confidence        : $confidence_clean
    classified_at_ms  : ($att.vision_classified_at_ms ?? 0)
  }

  guid = "get-attachment-vision-result-v1"
}
