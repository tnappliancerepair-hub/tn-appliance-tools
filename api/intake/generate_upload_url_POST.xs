// Generates metadata for an S3 upload and records it in the database.
// 6. Return metadata needed for Netlify Function to sign the URL
// Generates metadata for an S3 upload and records it in the database.
query generate_upload_url verb=POST {
  api_group = "intake"

  input {
    // The ID of the job this attachment belongs to.
    // Optional: chat-captured uploads use conversation_id instead until submit links them.
    int? job_id? {
      table = "jobs"
    }
  
    // For uploads captured during chat intake before a job exists.
    int? conversation_id? {
      table = "agent_conversation"
    }
  
    // The stage of the job for this attachment
    enum attachment_type {
      values = ["intake", "completion", "tdr"]
    }
  
    // The type of file being uploaded
    enum file_type {
      values = ["photo", "video"]
    }
  
    // The original filename from the user's device
    text original_filename filters=trim
  
    // The MIME type of the file (e.g., image/jpeg)
    text mime_type filters=trim
  
    // Who is uploading the file
    enum uploaded_by?=customer {
      values = ["customer", "tech", "teddy"]
    }
  
    // The technician ID if uploaded_by is 'tech'
    int tech_id? {
      table = "technicians"
    }
  
    // The technician's PIN for validation if uploaded_by is 'tech'
    text tech_pin? filters=trim
  }

  stack {
    // 1. Require at least one of (job_id, conversation_id)
    precondition ($input.job_id != null || $input.conversation_id != null) {
      error_type = "inputerror"
      error = "Either job_id or conversation_id is required"
    }
  
    // 1b. If job_id provided, validate the job exists
    var $job {
      value = null
    }
  
    conditional {
      if ($input.job_id != null) {
        db.get jobs {
          field_name = "id"
          field_value = $input.job_id
        } as $job
      
        precondition ($job != null) {
          error_type = "notfound"
          error = "Job not found"
        }
      }
    }
  
    // 2. If uploaded_by is "tech", validate the technician credentials
    conditional {
      if ($input.uploaded_by == "tech") {
        precondition ($input.tech_id != null && $input.tech_id > 0) {
          error_type = "inputerror"
          error = "Technician ID is required for tech uploads"
        }
      
        db.get technicians {
          field_name = "id"
          field_value = $input.tech_id
        } as $tech
      
        precondition ($tech != null) {
          error_type = "accessdenied"
          error = "Technician not found"
        }
      }
    }
  
    // 3. Build the S3 object key
    // Sanitize filename: replace anything that is not alphanumeric, dot, or hyphen with underscore
    var $clean_filename {
      value = $input.original_filename
        |regex_replace:"[^a-zA-Z0-9.-]":"_"
    }
  
    // Create a unique timestamp for the filename
    var $timestamp {
      value = (now|to_ms)|to_text
    }
  
    // Construct path prefix: jobs/{job_id} when we have a real job,
    // chat/{conversation_id} for chat-captured uploads before submit.
    var $path_prefix {
      value = ""
    }
  
    conditional {
      if ($input.job_id != null) {
        var.update $path_prefix {
          value = "jobs/" ~ ($input.job_id|to_text)
        }
      }
    
      else {
        var.update $path_prefix {
          value = "chat/" ~ ($input.conversation_id|to_text)
        }
      }
    }
  
    var $s3_key {
      value = $path_prefix ~ "/" ~ $input.attachment_type ~ "/" ~ $timestamp ~ "_" ~ $clean_filename
    }
  
    // 4. Insert metadata into job_attachments table
    db.add job_attachments {
      data = {
        job_id             : $input.job_id
        conversation_id    : $input.conversation_id
        attachment_type    : $input.attachment_type
        file_type          : $input.file_type
        s3_key             : $s3_key
        original_filename  : $input.original_filename
        mime_type          : $input.mime_type
        uploaded_by        : $input.uploaded_by
        uploaded_by_user_id: $input.tech_id|first_notempty:0
      }
    } as $attachment
  
    // 5. Log the action to event_log
    db.add event_log {
      data = {
        action  : "upload_url_generated"
        metadata: {
        job_id       : $input.job_id
        attachment_id: $attachment.id
        s3_key       : $s3_key
        uploaded_by  : $input.uploaded_by
      }
      }
    } as $log_entry
  }

  response = {
    success      : true
    s3_key       : $s3_key
    attachment_id: $attachment.id
    bucket       : $env.AWS_S3_BUCKET
    region       : $env.AWS_S3_REGION
    mime_type    : $input.mime_type
  }

  guid = "Ck6fUdaojB2jJ55V-FKQGV1jLlA"
}