//  Quick-fill the phone-critical fields right from the Phone-Ready board so the
//  office never has to leave the page: a missing warranty claim/WO number (on
//  the job) and a missing customer phone (on the customer record). Only
//  non-empty inputs overwrite, so a partial save never wipes good data.
//
//  No office password (the page is already gated; mirrors update_job_basics).
//  XS rules: no em-dashes, no backticks, no try/catch, data = { } for db.edit,
//  ?? and |trim only inside value = (...).
query office_quick_fill verb=POST {
  api_group = "intake"

  input {
    int job_id
    text? claim_number?
    text? customer_phone?
    text? actor?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "job not found"
    }

    var $cn { value = (($input.claim_number ?? "")|trim) }
    var $ph { value = (($input.customer_phone ?? "")|trim) }

    // Claim/WO number lives on the job. Keep existing if blank.
    var $new_claim { value = ($cn != "" ? $cn : ($job.claim_number ?? "")) }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        claim_number : $new_claim
      }
    }

    // Phone lives on the customer record. Only write when supplied + we have a customer.
    var $cid { value = ($job.customer_id ?? 0) }
    conditional {
      if ($ph != "" && $cid > 0) {
        db.edit customer {
          field_name = "id"
          field_value = $cid
          data = {
            phone : $ph
          }
        }
      }
    }

    db.add event_log {
      data = {
        action  : "office_quick_fill"
        metadata : {
          job_id       : $input.job_id
          claim_number : $new_claim
          phone_set    : ($ph != "")
          actor        : (($input.actor ?? "office")|trim)
        }
      }
    } as $log
  }

  response = {
    success      : true
    job_id       : $input.job_id
    claim_number : $new_claim
  }

  guid = "office-quick-fill-v1"
}
