// Vision agent writes its classification + extracted fields back to
// the job_attachments row.
query save_vision_classification verb=POST {
  api_group = "intake"

  input {
    int attachment_id
    text classification
    text extracted_json
    int confidence
    text status
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

    db.edit job_attachments {
      field_name = "id"
      field_value = $input.attachment_id
      data = {
        vision_classification : $input.classification
        vision_extracted      : $input.extracted_json
        vision_confidence     : $input.confidence
        vision_classified_at_ms: (now|to_ms)
        vision_status         : $input.status
      }
    }

    db.add event_log {
      data = {
        action  : "vision_classification_saved"
        metadata: ({attachment_id: $input.attachment_id, job_id: $att.job_id, classification: $input.classification, confidence: $input.confidence, status: $input.status, ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success      : true
    attachment_id: $input.attachment_id
    classification: $input.classification
  }

  guid = "save-vision-classification-v1"
}
