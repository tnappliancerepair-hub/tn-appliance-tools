// Vision agent fetches an attachment row + its s3_key so it can
// generate a signed URL to send to Claude vision.
query get_attachment_for_vision verb=GET {
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
  }

  response = {
    success      : true
    attachment_id: $att.id
    job_id       : ($att.job_id ?? 0)
    s3_key       : ($att.s3_key ?? "")
    mime_type    : ($att.mime_type ?? "")
    file_size    : ($att.file_size_bytes ?? 0)
    already_classified: (($att.vision_status ?? "pending") == "classified")
  }

  guid = "get-attachment-for-vision-v1"
}
