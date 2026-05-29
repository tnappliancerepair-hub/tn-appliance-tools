// Live mid-call escalation. Brain hands off to a human while the
// caller is still on the line. SMSes the target human immediately
// with the one-line summary so they can pick up informed.
//
// v1 surface: SMS-only handoff (no live phone transfer wired yet).
// Customer is told to expect a callback in seconds. v2 will integrate
// Vapi's transfer-to-number action when we wire the Vapi assistant
// config to allow live transfers.
query escalate_phone_call_to_human verb=POST {
  api_group = "intake"

  input {
    int? customer_id?
    text target filters=trim    // teddy | danielle | tech | any
    text summary filters=trim
    text? urgency?
    text? source?
  }

  stack {
    precondition ($input.target != "" && $input.summary != "") {
      error_type = "inputerror"
      error      = "target + summary required"
    }

    var $cust_first { value = "" }
    var $cust_phone { value = "" }
    conditional {
      if (($input.customer_id ?? 0) > 0) {
        db.get customer {
          field_name  = "id"
          field_value = $input.customer_id
        } as $cust
        conditional {
          if ($cust != null) {
            var $cust_first { value = ($cust.first_name ?? "") }
            var $cust_phone { value = ($cust.phone ?? "") }
          }
        }
      }
    }

    var $body { value = "[ant] ⚠ phone-brain escalation — " ~ $input.summary ~ (($cust_first != "") ? " | " ~ $cust_first : "") ~ (($cust_phone != "") ? " " ~ $cust_phone : "") }

    // Route to owner first; danielle as fallback target
    var $to_phone { value = "+16154855795" }
    conditional {
      if ($input.target == "danielle") {
        var $to_phone { value = "+16154850713" }
      }
    }

    api.request {
      url    = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      headers = ["content-type: application/json"]
      params = {
        to      : $to_phone
        message : $body
        context : {
          call_site    : "phone_brain.escalate_to_human"
          target       : $input.target
          urgency      : ($input.urgency ?? "medium")
          customer_id  : ($input.customer_id ?? 0)
          source       : ($input.source ?? "phone_brain")
        }
      }
      timeout = 8
    }

    db.add event_log {
      data = {
        action  : "phone_brain_escalated"
        metadata: {
          customer_id : ($input.customer_id ?? 0)
          target      : $input.target
          summary     : $input.summary
          urgency     : ($input.urgency ?? "medium")
          recorded_at : now|to_ms
        }|json_encode
      }
    }
  }

  response = {
    success: true
    target : $input.target
  }

  guid = "escalate-phone-call-to-human-v1"
}
