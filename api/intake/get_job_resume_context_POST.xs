// Returns minimal-PII context for the resume-mode chat flow.
// Called by index.html when customer lands at /?job_id=X&mode=resume.
// Returns ONLY: first_name, appliance_type, brand, phone_last4.
// Does NOT return full phone, email, address, diagnosis, or any other PII.
query get_job_resume_context verb=POST {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    precondition ($input.job_id != null && $input.job_id > 0) {
      error_type = "inputerror"
      error      = "job_id is required"
    }

    db.get jobs {
      field_name  = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error      = "Job not found"
    }

    var $customer { value = null }

    conditional {
      if ($job.customer_id != null && $job.customer_id > 0) {
        db.get customer {
          field_name  = "id"
          field_value = $job.customer_id
        } as $customer
      }
    }

    var $first_name {
      value = (($customer.first_name ?? "")|trim)
    }

    var $phone_digits {
      value = (($customer.phone ?? "")|replace:"+":""|replace:"-":""|replace:"(":""|replace:")":""|replace:" ":"")
    }

    var $phone_len {
      value = ($phone_digits|strlen)
    }

    var $last4_start {
      value = ($phone_len - 4)
    }

    var $phone_last4 { value = "" }

    conditional {
      if ($phone_len >= 4) {
        var.update $phone_last4 {
          value = ($phone_digits|substr:$last4_start)
        }
      }
    }
  }

  response = {
    success       : true
    job_id        : $job.id
    first_name    : $first_name
    appliance_type: ($job.appliance_type ?? "")
    brand         : ($job.brand ?? "")
    phone_last4   : $phone_last4
  }

  guid = "get-job-resume-context-v1"
}
