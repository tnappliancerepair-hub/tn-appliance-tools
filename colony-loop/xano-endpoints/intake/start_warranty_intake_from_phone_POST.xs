// Creates a job stub from a phone call + texts the customer the
// resume-chat URL so they fill in the rest in a structured form.
// The customer-facing chat is faster + more reliable than collecting
// the same info verbally.
query start_warranty_intake_from_phone verb=POST {
  api_group = "intake"

  input {
    int customer_id
    text? warranty_company?
    text? claim_number?
    text appliance_type filters=trim
    text problem_summary filters=trim
    text? source?
  }

  stack {
    precondition ($input.customer_id > 0 && $input.appliance_type != "") {
      error_type = "inputerror"
      error      = "customer_id + appliance_type required"
    }

    db.get customer {
      field_name  = "id"
      field_value = $input.customer_id
    } as $cust

    precondition ($cust != null) {
      error_type = "notfound"
      error      = "customer not found"
    }

    db.add jobs {
      data = {
        customer_id       : $input.customer_id
        intake_source     : "phone_brain"
        appliance_type    : $input.appliance_type
        problem_summary   : $input.problem_summary
        warranty_company  : ($input.warranty_company ?? "")
        claim_number      : ($input.claim_number ?? "")
        customer_type     : "warranty"
        scheduling_status : "not_ready"
        parallel_mode     : true
        created_at        : now|to_ms
      }
    } as $job

    var $phone_last4 { value = (($cust.phone ?? "")|regex_replace:"[^0-9]":"")|substr:-4:4 }
    var $portal_url { value = "https://tnapplianceexchange.net/customer-portal.html?job_id=" ~ $job.id ~ "&last4=" ~ $phone_last4 ~ "&mode=resume" }

    var $first { value = ($cust.first_name ?? "there") }
    var $body { value = "[TN Appliance] Hey " ~ $first ~ ", to finish setting up your repair we need a few details. Tap to fill them in: " ~ $portal_url }

    api.request {
      url    = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      headers = ["content-type: application/json"]
      params = {
        to      : ($cust.phone ?? "")
        message : $body
        context : {
          call_site : "phone_brain.start_warranty_intake"
          customer_id: $input.customer_id
          job_id    : $job.id
        }
      }
      timeout = 8
    }

    db.add colony_signals {
      data = {
        signal_type    : "WARRANTY_INTAKE_STARTED"
        signal_strength: 60
        source_colony  : "phone"
        target_colonies: ""
        payload        : {
          job_id     : $job.id
          customer_id: $input.customer_id
          warranty_company: ($input.warranty_company ?? "")
          claim_number: ($input.claim_number ?? "")
          source     : ($input.source ?? "phone_brain")
        }|json_encode
      }
    } as $signal
  }

  response = {
    success     : true
    job_id      : $job.id
    portal_url  : $portal_url
    signal_id   : $signal.id
  }

  guid = "start-warranty-intake-from-phone-v1"
}
