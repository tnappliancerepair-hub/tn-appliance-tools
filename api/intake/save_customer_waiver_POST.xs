// Customer signs release-of-liability digitally on /waiver.html. Flips
// jobs.waiver_signed_at to now and emits WAIVER_SIGNED so the loop emails
// an archival copy (with the signature image) to the waiver inbox.
//
// Auth model (2026-06-11): the customer reaches this from a link we texted
// to their own phone for their own job, so possession of the link IS the
// authentication. No phone-last-4 challenge — it was pure friction and
// locked out warranty customers who have no phone on file. phone_last4 is
// accepted (optional) for backward compat but never required or verified.
//
// Replaces the Jotform-based waiver flow.
query save_customer_waiver verb=POST {
  api_group = "intake"

  input {
    int   job_id
    text  signature_b64
    text? phone_last4?
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
