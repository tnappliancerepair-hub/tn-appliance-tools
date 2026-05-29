// Safety emergency tripwire. Fires owner alert + records the event.
// The phone brain calls this AGGRESSIVELY — false positive is fine,
// false negative isn't.
//
// Bypasses CUSTOMER_FACING_ENABLED gates because the owner SMS is
// internal (not customer-direction).
query mark_safety_emergency verb=POST {
  api_group = "intake"

  input {
    int? customer_id?
    text? phone?
    text emergency_type filters=trim
    text details filters=trim
    text? source?
  }

  stack {
    precondition ($input.emergency_type != "" && $input.details != "") {
      error_type = "inputerror"
      error      = "emergency_type + details required"
    }

    var $body { value = "[ant] 🚨 SAFETY EMERGENCY — " ~ $input.emergency_type ~ " | " ~ ($input.phone ?? "no phone") ~ " | " ~ $input.details }

    api.request {
      url    = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      headers = ["content-type: application/json"]
      params = {
        to      : "+16154855795"
        message : $body
        context : {
          call_site      : "phone_brain.mark_safety_emergency"
          emergency_type : $input.emergency_type
          customer_id    : ($input.customer_id ?? 0)
        }
      }
      timeout = 8
    }

    db.add event_log {
      data = {
        action  : "safety_emergency_flagged"
        metadata: {
          customer_id   : ($input.customer_id ?? 0)
          phone         : ($input.phone ?? "")
          emergency_type: $input.emergency_type
          details       : $input.details
          source        : ($input.source ?? "phone_brain")
          recorded_at   : now|to_ms
        }|json_encode
      }
    } as $audit
  }

  response = {
    success      : true
    event_log_id : $audit.id
  }

  guid = "mark-safety-emergency-v1"
}
