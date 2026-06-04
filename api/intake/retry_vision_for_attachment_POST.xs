// Tech taps "Re-analyze" — re-fires the ATTACHMENT_VISION_REQUEST
// signal for one attachment. Resets vision_status back to pending so
// the agent picks it up cleanly.
query retry_vision_for_attachment verb=POST {
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

    db.edit job_attachments {
      field_name = "id"
      field_value = $input.attachment_id
      data = {vision_status: "pending"}
    }

    var $payload_str {
      value = ({job_id: ($att.job_id ?? 0), attachment_id: $att.id, s3_key: ($att.s3_key ?? ""), file_type: ($att.file_type ?? "photo"), uploaded_by: ($att.uploaded_by ?? "tech_retry"), emitted_at_ms: (now|to_ms), source: "retry_vision"}|json_encode)
    }
    db.add colony_signals {
      data = {
        signal_type     : "ATTACHMENT_VISION_REQUEST"
        signal_strength : 70
        source_colony   : "intake"
        target_colonies : ""
        payload         : $payload_str
      }
    }

    db.add event_log {
      data = {
        action  : "attachment_vision_retry_requested"
        metadata: ({attachment_id: $att.id, job_id: ($att.job_id ?? 0), ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success      : true
    attachment_id: $att.id
    ack          : "Re-analyzing — give it a few seconds."
  }

  guid = "retry-vision-for-attachment-v1"
}
