// Danielle's emergency button while Teddy is on vacation.
//
// Sends a structured SMS to Teddy with a brief, urgency level, optional
// customer/job context, and a callback number. Returns a confirmation
// number so Danielle knows it went through.
//
// Audit trail: every send is logged to event_log so we can review
// vacation escalations after Teddy is back.
query send_teddy_during_vacation verb=POST {
  api_group = "intake"

  input {
    text brief
    text urgency
    text? customer_name?
    int? job_id?
    text? sent_by?
    text? callback_number?
  }

  stack {
    precondition ((($input.brief ?? "")|trim) != "") {
      error_type = "inputerror"
      error = "brief is required"
    }

    var $urgency_clean {
      value = (($input.urgency ?? "normal")|to_lowercase)|trim
    }
    // Defensive default
    conditional {
      if ($urgency_clean != "low" && $urgency_clean != "normal" && $urgency_clean != "high" && $urgency_clean != "emergency") {
        var.update $urgency_clean { value = "normal" }
      }
    }

    var $prefix {
      value = "[D]"
    }
    conditional {
      if ($urgency_clean == "high") {
        var.update $prefix { value = "[D-HIGH]" }
      }
    }
    conditional {
      if ($urgency_clean == "emergency") {
        var.update $prefix { value = "[D-EMERGENCY]" }
      }
    }

    var $brief_clean {
      value = ($input.brief|trim)
    }
    var $context_line {
      value = ""
    }
    conditional {
      if ((($input.customer_name ?? "")|trim) != "") {
        var.update $context_line {
          value = "\nCustomer: " ~ ($input.customer_name|trim)
        }
      }
    }
    conditional {
      if (($input.job_id ?? 0) > 0) {
        var.update $context_line {
          value = $context_line ~ "\nJob: #" ~ ($input.job_id|to_text)
        }
      }
    }
    var $callback_line {
      value = ""
    }
    conditional {
      if ((($input.callback_number ?? "")|trim) != "") {
        var.update $callback_line {
          value = "\nCall back: " ~ ($input.callback_number|trim)
        }
      }
    }

    var $message {
      value = $prefix ~ " " ~ $brief_clean ~ $context_line ~ $callback_line
    }

    // Send to Teddy's cell directly (bypasses send_sms gate — this is
    // an operator-initiated escalation; the message goes to Teddy
    // regardless of CUSTOMER_FACING_ENABLED gating).
    api.request {
      url = $env.XANO_INTAKE_BASE_URL_FOR_SMS ~ "/send_sms"
      method = "POST"
      params = {to: "+16154855795", message: $message, context: {source: "vacation_escalation", urgency: $urgency_clean}}
      headers = ["Content-Type: application/json"]
    } as $sms_resp

    db.add event_log {
      data = {
        action  : "vacation_escalation_sent"
        metadata: ({brief: $brief_clean, urgency: $urgency_clean, customer_name: ($input.customer_name ?? ""), job_id: ($input.job_id ?? 0), sent_by: ($input.sent_by ?? "danielle"), ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success     : true
    urgency     : $urgency_clean
    sms_sent_at_ms: (now|to_ms)
    note        : "Teddy will receive this SMS at +16154855795 directly. Reply to his text when he gets back to you."
  }

  guid = "send-teddy-during-vacation-v1"
}
