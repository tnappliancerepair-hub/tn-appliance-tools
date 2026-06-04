// Customer vent channel — catch 1-2 star feedback BEFORE it lands on
// Google Reviews. Customer submits a "what went wrong" form via the
// customer portal or post-job SMS link. Their feedback lands here
// instead of going public. Teddy/Danielle get a heads-up SMS so they
// can reach out and resolve.
query record_customer_vent verb=POST {
  api_group = "intake"

  input {
    int? job_id?
    text? customer_first_name?
    text? customer_phone?
    text? customer_email?
    text vent_text
    text? rating?
  }

  stack {
    precondition (($input.vent_text ?? "")|trim != "") {
      error_type = "inputerror"
      error = "vent_text is required"
    }

    var $rating_clean {
      value = (($input.rating ?? "unspecified")|to_lowercase)|trim
    }
    var $job_id_clean {
      value = ($input.job_id ?? 0)
    }
    var $name_clean {
      value = (($input.customer_first_name ?? "")|trim)
    }
    var $phone_clean {
      value = (($input.customer_phone ?? "")|trim)
    }
    var $vent_clean {
      value = $input.vent_text|trim
    }

    // Owner-direction SMS — alerts Teddy AND Danielle (via vacation
    // backup) so the issue gets a human reach-out within minutes.
    var $alert_body {
      value = "[VENT] " ~ $rating_clean ~ " star — " ~ ($name_clean != "" ? $name_clean : "anonymous") ~ ($job_id_clean > 0 ? " (job #" ~ ($job_id_clean|to_text) ~ ")" : "") ~ ": " ~ ($vent_clean|substr:0:200)
    }
    api.request {
      url = $env.XANO_INTAKE_BASE_URL_FOR_SMS ~ "/send_sms"
      method = "POST"
      params = {to: "+16154855795", message: $alert_body, context: {source: "customer_vent_channel", rating: $rating_clean}}
      headers = ["Content-Type: application/json"]
    } as $sms_resp

    db.add event_log {
      data = {
        action  : "customer_vent_received"
        metadata: ({job_id: $job_id_clean, rating: $rating_clean, customer_name: $name_clean, customer_phone: $phone_clean, vent_text: $vent_clean, ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success     : true
    received_at_ms: (now|to_ms)
    note        : "Thank you for telling us. Teddy was just notified and someone will reach out within 24 hours to make this right."
  }

  guid = "record-customer-vent-v1"
}
