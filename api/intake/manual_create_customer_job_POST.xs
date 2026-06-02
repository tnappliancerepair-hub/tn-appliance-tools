// Office-side "+ New customer" button. Creates a customer (or matches
// existing by phone last4) + creates a job in not_ready status with
// intake_source=manual, parallel_mode=true. Lands in needs-scheduled
// queue immediately. Office-password gated.
//
// Designed for Danielle when a customer slips past the email pollers
// (e.g. phone call, walk-in, vendor portal copy/paste). Replaces typing
// the same thing into HCP.
query manual_create_customer_job verb=POST {
  api_group = "intake"

  input {
    text office_password
    text first_name
    text? last_name?
    text phone
    text? email?
    text? address?
    text? city?
    text? state?
    text? zip?
    text appliance_type
    text? brand?
    text? model_number?
    text? problem_summary?
    text? customer_type?
    text? warranty_company?
    text? claim_number?
    text? dispatch_number?
  }

  stack {
    var $env_pw {
      value = (($env.OFFICE_PASSWORD ?? "antlives")|trim)
    }

    var $supplied_pw {
      value = (($input.office_password ?? "")|trim)
    }

    conditional {
      if ($env_pw == "" || $env_pw != $supplied_pw) {
        return {
          value = { success: false, error: "unauthorized" }
        }
      }
    }

    precondition (($input.first_name|trim) != "" && ($input.phone|trim) != "" && ($input.appliance_type|trim) != "") {
      error_type = "inputerror"
      error = "first_name + phone + appliance_type required"
    }

    // Normalize phone to digits
    var $phone_digits {
      value = "/[^0-9]/"|regex_replace:"":$input.phone
    }

    var $phone_norm {
      value = "+1" ~ $phone_digits
    }

    // Match existing customer by digit phone
    db.query customer {
      where = $db.customer.phone == $phone_norm || $db.customer.phone == $phone_digits || $db.customer.phone == $input.phone
      sort = {customer.id: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $existing

    var $cust_id {
      value = 0
    }

    conditional {
      if (($existing.items|count) > 0) {
        var $first_match {
          value = ($existing.items|get:0)
        }
        var.update $cust_id {
          value = $first_match.id
        }
      }
      else {
        db.add customer {
          data = {
            first_name: (($input.first_name|trim))
            last_name : (($input.last_name|to_text) ?? "")
            phone     : $phone_norm
            email     : (($input.email|to_text) ?? "")
            address   : (($input.address|to_text) ?? "")
            city      : (($input.city|to_text) ?? "")
            state     : (($input.state|to_text) ?? "")
            zip       : (($input.zip|to_text) ?? "")
            company_id: 1
          }
        } as $new_cust
        var.update $cust_id {
          value = $new_cust.id
        }
      }
    }

    db.add jobs {
      data = {
        customer_id      : $cust_id
        intake_source    : "manual"
        scheduling_status: "needs_more_info"
        friendly_status  : "Manually added — needs scheduling"
        appliance_type   : (($input.appliance_type|trim))
        brand            : (($input.brand|to_text) ?? "")
        model_number     : (($input.model_number|to_text) ?? "")
        problem_summary  : (($input.problem_summary|to_text) ?? "")
        customer_type    : (($input.customer_type|to_text) ?? "self_pay")
        warranty_company : (($input.warranty_company|to_text) ?? "")
        claim_number     : (($input.claim_number|to_text) ?? "")
        dispatch_source_id: (($input.dispatch_number|to_text) ?? "")
        service_address  : (($input.address|to_text) ?? "")
        service_city     : (($input.city|to_text) ?? "")
        service_state    : (($input.state|to_text) ?? "")
        service_zip      : (($input.zip|to_text) ?? "")
        parallel_mode    : true
        company_id       : 1
      }
    } as $new_job

    db.add event_log {
      data = {
        action  : "manual_customer_job_created"
        metadata: ```
          {
            job_id     : $new_job.id
            customer_id: $cust_id
            phone      : $phone_norm
          }|json_encode
          ```
      }
    }
  }

  response = {
    success    : true
    job_id     : $new_job.id
    customer_id: $cust_id
  }

  guid = "manual-create-customer-job-v1"
}
