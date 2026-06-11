// Ant Field Assist tool — Brooke asks for a pic, this fires the SMS
// to the tech's phone with the per-job upload link. Tech taps, snaps,
// uploads. Photo lands on the job and Vapi conversation continues.
query request_photo_via_sms verb=POST {
  api_group = "intake"

  input {
    int job_id
    int tech_id
    text purpose
  }

  stack {
    db.get technicians {
      field_name = "id"
      field_value = $input.tech_id
    } as $tech

    precondition ($tech != null) {
      error_type = "notfound"
      error = "tech not found"
    }
    precondition ((($tech.phone ?? "")|trim) != "") {
      error_type = "inputerror"
      error = "tech has no phone on file"
    }

    var $tech_phone {
      value = $tech.phone|trim
    }
    var $purpose_clean {
      value = ($input.purpose ?? "model_sticker")|to_lowercase|trim
    }
    var $purpose_label {
      value = $purpose_clean == "model_sticker" ? "model sticker" : ($purpose_clean == "error_code" ? "error code" : ($purpose_clean == "damage" ? "damage" : ($purpose_clean == "part" ? "part" : "what you're seeing")))
    }
    var $upload_url {
      value = "https://tnapplianceexchange.net/upload.html?job_id=" ~ ($input.job_id|to_text) ~ "&tech_id=" ~ ($input.tech_id|to_text) ~ "&purpose=" ~ $purpose_clean
    }
    var $sms_body {
      value = "[ant] snap a pic of the " ~ $purpose_label ~ " — " ~ $upload_url
    }

    api.request {
      url = $env.XANO_INTAKE_BASE_URL_FOR_SMS ~ "/send_sms"
      method = "POST"
      params = {to: $tech_phone, message: $sms_body, context: {source: "ant_field_assist", job_id: $input.job_id, purpose: $purpose_clean}}
      headers = ["Content-Type: application/json"]
    } as $sms_resp

    db.add event_log {
      data = {
        action  : "ant_field_assist_photo_requested"
        metadata: ({job_id: $input.job_id, tech_id: $input.tech_id, purpose: $purpose_clean, upload_url: $upload_url, ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success: true
    sent_to: $tech_phone
    ack    : "Link's in your texts."
    upload_url: $upload_url
  }

  guid = "request-photo-via-sms-v1"
}
