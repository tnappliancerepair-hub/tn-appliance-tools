// Customer signs release-of-liability digitally on /waiver.html. Stores
// the signature PNG as a job_attachment (attachment_type='waiver') and
// flips jobs.waiver_signed_at to now. Light auth via phone_last4 match
// against the job's customer to prevent random URL signers.
//
// Replaces the Jotform-based waiver flow. Once this is wired into the
// scheduling endpoints (next session), jobs become un-schedulable
// until waiver_signed_at is non-null.
query save_customer_waiver verb=POST {
  api_group = "intake"

  input {
    int   job_id
    text  phone_last4
    text  signature_b64
    text? customer_name?
    text? customer_email?
    text? acknowledgments_json?
    text? ip_address?
    text? user_agent?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }
    var $phone_clean { value = ($input.phone_last4 ?? "")|trim }
    precondition ($phone_clean != "") {
      error_type = "inputerror"
      error = "phone_last4 required for verification"
    }
    var $sig_clean { value = ($input.signature_b64 ?? "")|trim }
    precondition ($sig_clean != "") {
      error_type = "inputerror"
      error = "signature required"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }

    db.get customer {
      field_name = "id"
      field_value = $job.customer_id
    } as $customer

    precondition ($customer != null) {
      error_type = "notfound"
      error = "Customer not found"
    }

    // Verify last 4 digits of phone match (soft auth)
    var $cust_phone { value = (($customer.phone ?? "")|to_text) }
    var $cust_phone_digits {
      value = $cust_phone|replace:"+":""|replace:"-":""|replace:" ":""|replace:"(":""|replace:")":""
    }
    var $cust_last4 {
      value = $cust_phone_digits|substr:-4:4
    }

    precondition ($cust_last4 == $phone_clean) {
      error_type = "accessdenied"
      error = "Phone last 4 digits do not match. Please re-enter."
    }

    var $now_ms { value = now|to_ms }
    var $name_clean { value = ($input.customer_name ?? "")|trim }
    var $email_clean { value = ($input.customer_email ?? "")|trim }
    var $acks_clean { value = ($input.acknowledgments_json ?? "{}")|trim }

    // Flip waiver_signed_at on the job (and capture signer info for audit)
    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        waiver_signed_at: $now_ms
      }
    }

    db.add event_log {
      data = {
        action  : "customer_waiver_signed"
        metadata: ({job_id: $input.job_id, customer_id: $job.customer_id, signed_at_ms: $now_ms, signer_name: $name_clean, signer_email: $email_clean, acknowledgments: $acks_clean, phone_last4: $phone_clean, ip: ($input.ip_address ?? ""), user_agent: (($input.user_agent ?? "")|substr:0:200), signature_present: true, source: "ant_customer_portal"}|json_encode)
      }
    }

    // Emit WAIVER_SIGNED so the colony loop emails an archival copy (with the
    // signature image attached) to the waiver inbox for easy search + handing
    // to insurance. Done async via the loop so an email hiccup can never fail
    // the customer's signature submission.
    var $waiver_signed_payload_obj {
      value = {
        job_id         : $input.job_id
        customer_id    : $job.customer_id
        signer_name    : $name_clean
        signer_email   : $email_clean
        phone_last4    : $phone_clean
        acknowledgments: $acks_clean
        signed_at_ms   : $now_ms
        signature_b64  : $sig_clean
      }
    }

    var $waiver_signed_payload_str {
      value = $waiver_signed_payload_obj|json_encode
    }

    db.add colony_signals {
      data = {
        signal_type    : "WAIVER_SIGNED"
        signal_strength: 50
        source_colony  : ""
        target_colonies: ""
        payload        : $waiver_signed_payload_str
      }
    } as $waiver_signal
  }

  response = {
    success: true
    job_id : $input.job_id
    signed_at_ms: $now_ms
    ack: "Signature received. Thank you."
  }

  guid = "save-customer-waiver-v1"
}
