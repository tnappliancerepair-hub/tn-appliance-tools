// Structured refund request capture. Customer or office initiates;
// Teddy/Danielle reviews + decides. Policy-based auto-classification
// (small amount + warranty job = likely auto-approve; large amount or
// non-warranty = manual review).
query record_refund_request verb=POST {
  api_group = "intake"

  input {
    int job_id
    int amount_cents
    text reason_short
    text? requested_by?
    text? customer_first_name?
    text? notes?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }
    precondition ($input.amount_cents > 0) {
      error_type = "inputerror"
      error = "amount_cents must be > 0"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }

    // Policy v1: tag classification
    // - amount <= $25 (2500 cents) AND warranty job → recommend auto-approve
    // - amount > $200 (20000 cents) → flag as high-value (manual)
    // - else → standard review
    var $is_warranty {
      value = (($job.customer_type ?? "") == "warranty")
    }
    var $classification {
      value = "standard_review"
    }
    conditional {
      if ($input.amount_cents <= 2500 && $is_warranty == true) {
        var.update $classification { value = "recommend_auto_approve" }
      }
    }
    conditional {
      if ($input.amount_cents > 20000) {
        var.update $classification { value = "high_value_manual" }
      }
    }

    var $dollar_str {
      value = "$" ~ (($input.amount_cents / 100)|to_text)
    }

    // SMS alert to Teddy
    var $alert_body {
      value = "[REFUND] " ~ $dollar_str ~ " — " ~ ($input.reason_short|trim) ~ " (job #" ~ ($input.job_id|to_text) ~ ") — " ~ $classification
    }
    api.request {
      url = $env.XANO_INTAKE_BASE_URL_FOR_SMS ~ "/send_sms"
      method = "POST"
      params = {to: "+16154855795", message: $alert_body, context: {source: "refund_request", classification: $classification}}
      headers = ["Content-Type: application/json"]
    } as $sms_resp

    db.add event_log {
      data = {
        action  : "refund_request_received"
        metadata: ({job_id: $input.job_id, amount_cents: $input.amount_cents, reason: $input.reason_short, classification: $classification, requested_by: ($input.requested_by ?? "office"), customer_name: ($input.customer_first_name ?? ""), notes: ($input.notes ?? ""), is_warranty: $is_warranty, ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success       : true
    job_id        : $input.job_id
    amount_cents  : $input.amount_cents
    amount_dollar : $dollar_str
    classification: $classification
    note          : "Refund request logged. Teddy got an SMS. Decision typically comes back within 24 business hours."
  }

  guid = "record-refund-request-v1"
}
