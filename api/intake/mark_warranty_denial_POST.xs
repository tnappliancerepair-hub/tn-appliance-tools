// Office endpoint to mark a warranty claim as denied + emit
// WARRANTY_DENIAL_RETRY signal for the retry agent.
query mark_warranty_denial verb=POST {
  api_group = "intake"

  input {
    int job_id
    text denial_reason
    text? claim_number?
    text? vendor?
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }
  
    var $vendor_clean {
      value = (($input.vendor ?? ($job.warranty_company ?? "AHS"))|trim|upper)
    }
  
    var $claim_clean {
      value = (($input.claim_number ?? ($job.claim_number ?? ""))|trim)
    }
  
    var $payload_obj {
      value = {
        job_id       : $job.id
        denial_reason: $input.denial_reason
        claim_number : $claim_clean
        vendor       : $vendor_clean
      }
    }
  
    var $payload_json {
      value = $payload_obj|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "WARRANTY_DENIAL_RETRY"
        signal_strength: 75
        source_colony  : "office_warranty_review"
        target_colonies: ""
        payload        : $payload_json
      }
    } as $signal_row
  
    db.add event_log {
      data = {
        action  : "warranty_denial_marked"
        metadata: $payload_json
      }
    } as $audit_row
  }

  response = {
    success  : true
    job_id   : $job.id
    signal_id: $signal_row.id
  }

  guid = "mark-warranty-denial-v1"
}