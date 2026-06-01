// Returns all attachments (photos/videos) for a specific job.
// This is used by the Teddy dashboard and other internal tools to display media.
// Set the API response to the result object.
// Returns all attachments (photos/videos) for a specific job, used by the Teddy dashboard and other internal tools to display media.
query get_job_attachments verb=GET {
  api_group = "intake"

  input {
    // The ID of the job to fetch attachments for.
    int job_id
  }

  stack {
    // Validate that the job_id is provided and valid.
    precondition ($input.job_id != null && $input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id is required"
    }
  
    // Query the job_attachments table for all rows matching the job_id, sorted by newest first.
    db.query job_attachments {
      where = $db.job_attachments.job_id == $input.job_id
      sort = {created_at: "desc"}
      return = {type: "list"}
    } as $attachment_rows
  
    // Initialize an empty list to hold the cleaned attachment objects.
    var $attachments {
      value = []
    }
  
    // Loop through each row and select only the fields needed for the dashboard.
    foreach ($attachment_rows) {
      each as $row {
        // Create a clean object for each attachment.
        var $clean_item {
          value = {
            id                 : $row.id
            created_at         : $row.created_at
            attachment_type    : $row.attachment_type
            file_type          : $row.file_type
            s3_key             : $row.s3_key
            original_filename  : $row.original_filename
            file_size_bytes    : $row.file_size_bytes
            mime_type          : $row.mime_type
            uploaded_by        : $row.uploaded_by
            uploaded_by_user_id: $row.uploaded_by_user_id
            upload_complete_at : $row.upload_complete_at
            viewed_by_tech_at  : $row.viewed_by_tech_at
            caption            : $row.caption
          }
        }
      
        // Add the clean object to the attachments list.
        array.push $attachments {
          value = $clean_item
        }
      }
    }
  
    // Prepare the final success response containing the job ID and attachments.
    var $result {
      value = {
        success    : true
        job_id     : $input.job_id
        count      : $attachments|count
        attachments: $attachments
      }
    }
  }

  response = $result
  guid = "DRxcZgAxrHKQcbqBwVY4fy0Ew_E"
}