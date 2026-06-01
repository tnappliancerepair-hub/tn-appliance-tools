// Receives voicemail capture from Vapi webhook when an inbound call
// falls through to "leave a message" (the 1% Vapi can't handle directly).
// Writes event_log row that Office Today surfaces as a pending callback.
//
// Vapi webhook payload (configured in Vapi dashboard → Ant Inbound agent):
//   POST → netlify/functions/vapi-voicemail-webhook → this endpoint
//   { caller_phone, transcript, vapi_call_id, duration_seconds?, intent? }
query record_vapi_voicemail verb=POST {
  api_group = "intake"

  input {
    text caller_phone
    text transcript
    text? vapi_call_id?
    int? duration_seconds?
    text? intent?
  }

  stack {
    precondition (($input.caller_phone ?? "")|trim != "") {
      error_type = "inputerror"
      error = "caller_phone required"
    }

    var $phone_clean {
      value = (($input.caller_phone ?? "")|trim)
    }

    var $transcript_clean {
      value = (($input.transcript ?? "")|trim)
    }

    var $phone_digits {
      value = ($phone_clean|replace:"+":""|replace:" ":""|replace:"-":""|replace:"(":""|replace:")":"")
    }

    var $phone_last10 {
      value = ($phone_digits|substr:(-10):10)
    }

    db.query customer {
      where = $db.customer.phone == $phone_clean
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $cust_rows

    var $cust {
      value = (($cust_rows.items|first) ?? null)
    }

    var $matched_customer_id {
      value = ($cust != null) ? $cust.id : 0
    }

    db.add event_log {
      data = {
        action  : "vapi_voicemail_received"
        metadata: {
        caller_phone     : $phone_clean
        transcript       : $transcript_clean
        vapi_call_id     : ($input.vapi_call_id ?? "")
        duration_seconds : ($input.duration_seconds ?? 0)
        intent           : ($input.intent ?? "")
        matched_customer_id: $matched_customer_id
        cleared          : false
      }
      }
    } as $audit

    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      params = {to: "+16154855795", message: ("[ant] new voicemail from " ~ $phone_clean ~ ":\n" ~ ($transcript_clean|substr:0:200)), context_tag: "vapi_voicemail_alert"}
      headers = ["Content-Type: application/json"]
      timeout = 30
    } as $owner_alert
  }

  response = {
    success            : true
    event_log_id       : $audit.id
    matched_customer_id: $matched_customer_id
  }

  guid = "record-vapi-voicemail-v1"
}
