// Office staff submit a change request to "Ant". They never know
// the request actually routes to Teddy via SMS for approve/decline.
// Ant replies them in-character whichever way Teddy decides.
query record_change_request verb=POST {
  api_group = "intake"

  input {
    text title
    text body
    text? requester_name?
    text? requester_phone?
    text? requester_role?
    text? area?
    text? related_job_id?
  }

  stack {
    precondition (($input.title ?? "")|trim != "") {
      error_type = "inputerror"
      error = "title required"
    }
    precondition (($input.body ?? "")|trim != "") {
      error_type = "inputerror"
      error = "body required"
    }

    var $name_clean { value = (($input.requester_name ?? "Office")|trim) }
    var $phone_clean { value = (($input.requester_phone ?? "")|trim) }
    var $role_clean { value = (($input.requester_role ?? "office")|trim) }
    var $area_clean { value = (($input.area ?? "warranty_review")|trim) }
    var $title_clean { value = $input.title|trim }
    var $body_clean { value = $input.body|trim }
    var $job_id_clean { value = (($input.related_job_id ?? "")|trim) }

    db.add change_requests {
      data = {
        requester_name  : $name_clean
        requester_phone : $phone_clean
        requester_role  : $role_clean
        area            : $area_clean
        title           : $title_clean
        body            : $body_clean
        status          : "pending"
        related_job_id  : $job_id_clean
      }
    } as $row

    // SMS Teddy with the request + reply keywords
    var $teddy_body {
      value = "[change request #" ~ ($row.id|to_text) ~ "] " ~ $name_clean ~ " (" ~ $area_clean ~ "): " ~ $title_clean ~ "\n\n" ~ ($body_clean|substr:0:400) ~ "\n\nReply APPROVE-" ~ ($row.id|to_text) ~ " to apply, DECLINE-" ~ ($row.id|to_text) ~ " to decline."
    }
    api.request {
      url = $env.XANO_INTAKE_BASE_URL_FOR_SMS ~ "/send_sms"
      method = "POST"
      params = {to: "+16154855795", message: $teddy_body, recipient_role: "owner", context: {source: "change_request_received", change_request_id: ($row.id|to_text), area: $area_clean}}
      headers = ["Content-Type: application/json"]
    } as $teddy_sms

    // SMS the requester an in-character Ant acknowledgement (if phone known)
    var $req_ack {
      value = "Hey " ~ $name_clean ~ " — Ant here. Got your request: \"" ~ ($title_clean|substr:0:120) ~ "\". Logged it, looking into it. I'll text you back when it's sorted."
    }
    conditional {
      if ($phone_clean != "") {
        api.request {
          url = $env.XANO_INTAKE_BASE_URL_FOR_SMS ~ "/send_sms"
          method = "POST"
          params = {to: $phone_clean, message: $req_ack, recipient_role: $role_clean, context: {source: "change_request_acknowledgement", change_request_id: ($row.id|to_text)}}
          headers = ["Content-Type: application/json"]
        } as $req_sms
      }
    }

    db.add event_log {
      data = {
        action  : "change_request_submitted"
        metadata: ({change_request_id: $row.id, requester_name: $name_clean, area: $area_clean, title: $title_clean, ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success: true
    change_request_id: $row.id
    ack    : "Got it — Ant will text you back when it's reviewed."
  }

  guid = "record-change-request-v1"
}
