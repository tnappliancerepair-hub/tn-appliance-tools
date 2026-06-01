// This endpoint is called by the frontend AFTER a successful S3 upload completes.
// It marks an existing job_attachments row as upload-complete by setting the upload_complete_at timestamp and updating the file_size_bytes.
// 7. Return a success response with:
// - success: true
// - attachment_id: the input attachment_id
// - upload_completed_at: now_ts
// - file_size_bytes: size_to_save
// Marks a job attachment as upload-complete and logs the event.
// Input parameters for the endpoint
query save_attachment verb=POST {
  api_group = "intake"

  input {
    // the ID of the row in job_attachments table to update
    int attachment_id
  
    // the actual file size after upload, in bytes. If not provided or zero, save as 0.
    int file_size_bytes?
  }

  stack {
    // 1. Validate that attachment_id is provided and greater than 0. If not, return an error with message "attachment_id is required".
    precondition ($input.attachment_id > 0) {
      error_type = "inputerror"
      error = "attachment_id is required"
    }
  
    // 2. Fetch the row from the job_attachments table using attachment_id. If no row is found, return a "NotFound" error with message "Attachment not found".
    db.get job_attachments {
      field_name = "id"
      field_value = $input.attachment_id
    } as $attachment
  
    precondition ($attachment != null) {
      error_type = "notfound"
      error = "Attachment not found"
    }
  
    // 3. Set a variable size_to_save: if file_size_bytes input is provided and greater than 0, use it; otherwise use 0.
    var $size_to_save {
      value = 0
    }
  
    conditional {
      if ($input.file_size_bytes > 0) {
        var.update $size_to_save {
          value = $input.file_size_bytes
        }
      }
    }
  
    // 4. Set a variable now_ts to the current timestamp.
    var $now_ts {
      value = now
    }
  
    // 5. Update the job_attachments row (matched by id = attachment_id) with:
    // - file_size_bytes = size_to_save
    // - upload_complete_at = now_ts
    db.edit job_attachments {
      field_name = "id"
      field_value = $input.attachment_id
      data = {
        file_size_bytes   : $size_to_save
        upload_complete_at: $now_ts
      }
    } as $updated_attachment
  
    // 6. Insert a new row into event_log with:
    // - action = "attachment_upload_completed"
    // - metadata = a JSON object containing: attachment_id, job_id, s3_key, file_size_bytes
    // - created_at = now_ts
    db.add event_log {
      data = {
        action    : "attachment_upload_completed"
        metadata  : {
        attachment_id  : $input.attachment_id
        job_id         : $attachment.job_id
        s3_key         : $attachment.s3_key
        file_size_bytes: $size_to_save
      }
        created_at: $now_ts
      }
    } as $new_event_log
  }

  response = {
    success            : true
    attachment_id      : $input.attachment_id
    upload_completed_at: $now_ts
    file_size_bytes    : $size_to_save
  }

  guid = "3pcbyufeZxigUI5BTKHtd95KNP8"
}