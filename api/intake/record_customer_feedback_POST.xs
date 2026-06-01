// Manually records a customer feedback rating + comment. Office uses
// this to capture rating data from phone/email feedback that bypasses
// the SMS path. Emits CUSTOMER_FEEDBACK_RECEIVED so future agents can
// react (LOW_RATING_ALERT, GOOGLE_REVIEW_REQUEST gating, etc).
query record_customer_feedback verb=POST {
  api_group = "intake"

  input {
    int job_id
    int rating
    text? comment?
    text? source?
  }

  stack {
    precondition ($input.rating >= 1 && $input.rating <= 5) {
      error_type = "inputerror"
      error = "rating must be 1-5"
    }
  
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }
  
    var $comment_clean {
      value = ($input.comment ?? "")|trim
    }
  
    var $source_clean {
      value = ($input.source ?? "office_manual")|trim
    }
  
    // Audit row
    var $meta {
      value = {
        job_id       : $job.id
        customer_id  : ($job.customer_id ?? 0)
        technician_id: ($job.technician_id ?? 0)
        rating       : $input.rating
        comment      : $comment_clean
        source       : $source_clean
      }
    }
  
    var $meta_json {
      value = $meta|json_encode
    }
  
    db.add event_log {
      data = {
        action  : "customer_feedback_recorded"
        metadata: $meta_json
      }
    } as $audit_row
  
    // Signal emit for downstream agents
    var $signal_payload_json {
      value = $meta|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "CUSTOMER_FEEDBACK_RECEIVED"
        signal_strength: ($input.rating <= 2 ? 90 : 50)
        source_colony  : "customer_feedback_form"
        target_colonies: ""
        payload        : $signal_payload_json
      }
    } as $signal_row
  }

  response = {
    success     : true
    job_id      : $job.id
    rating      : $input.rating
    signal_id   : $signal_row.id
    event_log_id: $audit_row.id
  }

  guid = "record-customer-feedback-v1"
}