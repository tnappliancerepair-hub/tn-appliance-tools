// Sends a customer a link via SMS during a phone call. Routes through
// send_sms (the gated layer — CUSTOMER_FACING_ENABLED is respected).
//
// Used by the phone brain when the agent says "I'll text you the
// link" — actually has to call this for it to be true.
query send_customer_a_link verb=POST {
  api_group = "intake"

  input {
    int customer_id
    text? phone?
    text link_type filters=trim
    text url filters=trim
    text? note?
    text? source?
  }

  stack {
    precondition ($input.customer_id > 0 && $input.url != "") {
      error_type = "inputerror"
      error      = "customer_id + url required"
    }

    db.get customer {
      field_name  = "id"
      field_value = $input.customer_id
    } as $cust

    var $phone { value = (($input.phone ?? "") != "") ? $input.phone : (($cust != null) ? ($cust.phone ?? "") : "") }

    precondition ($phone != "") {
      error_type = "notfound"
      error      = "no phone on file for customer"
    }

    var $first { value = ($cust != null) ? ($cust.first_name ?? "there") : "there" }
    var $note_clause { value = (($input.note ?? "") != "") ? (" " ~ $input.note) : "" }
    var $body { value = "[TN Appliance] Hey " ~ $first ~ "," ~ $note_clause ~ " " ~ $input.url }

    api.request {
      url    = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      headers = ["content-type: application/json"]
      params = {
        to      : $phone
        message : $body
        context : {
          call_site   : "phone_brain.send_customer_a_link"
          link_type   : $input.link_type
          customer_id : $input.customer_id
          source      : ($input.source ?? "phone_brain")
        }
      }
      timeout = 8
    } as $sms_resp

    db.add event_log {
      data = {
        action  : "phone_brain_sent_link"
        metadata: {
          customer_id : $input.customer_id
          phone       : $phone
          link_type   : $input.link_type
          url         : $input.url
          source      : ($input.source ?? "phone_brain")
          recorded_at : now|to_ms
        }|json_encode
      }
    }
  }

  response = {
    success  : true
    sent_to  : $phone
    link_type: $input.link_type
  }

  guid = "send-customer-a-link-v1"
}
