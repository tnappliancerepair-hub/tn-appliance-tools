// Sends the initial feedback request SMS to a customer.
// 2026-06-11: routed through the gated send_sms endpoint so the customer-facing
// master switch (CUSTOMER_FACING_ENABLED) + the sms_test_allowlist govern this
// send. Previously this called Twilio directly and only checked SMS_ENABLED,
// so 24h follow-ups leaked to customers even when the customer gate was off.
query send_feedback_sms verb=POST {
  api_group = "intake"

  input {
    int job_id {
      table = "jobs"
    }

    text customer_phone filters=trim
    text customer_first_name filters=trim
  }

  stack {
    // 1. Check jobs table — if feedback_sent = true, stop
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error = "Job not found"
    }

    conditional {
      if ($job.feedback_sent) {
        return {
          value = {success: true, message: "Feedback already sent"}
        }
      }
    }

    // 2. Build SMS body
    var $sms_body {
      value = "Hey " ~ $input.customer_first_name ~ "! It's TN Appliance Exchange — your repair is complete. How did we do?\n\nReply 5 = Great experience 👍\nReply 0 = Had an issue 👎\nJust reply with a number and we'll take it from there."
    }

    // 3. Route through the gated send_sms endpoint. send_sms applies the
    //    SMS_ENABLED gate, the CUSTOMER_FACING_ENABLED customer gate, the
    //    sms_test_allowlist bypass, internal-vs-customer classification, and
    //    provider selection — one source of truth for every customer text.
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      params = {
        to         : $input.customer_phone
        message    : $sms_body
        context_tag: "feedback_request"
      }
      headers = ["Content-Type: application/json"]
      timeout = 30
    } as $send_resp

    var $send_ok {
      value = (($send_resp.response.result.success ?? false) == true)
    }

    var $send_gated {
      value = ($send_resp.response.result.gated ?? false)
    }

    // 4. Only mark feedback_sent when the text actually went out. If it was
    //    gated (customer gate off, not allowlisted), leave the flag clear so
    //    the follow-up still fires once the gate is enabled.
    conditional {
      if ($send_ok == true) {
        db.patch jobs {
          field_name = "id"
          field_value = $input.job_id
          data = {feedback_sent: true, feedback_sent_at: now}
        }
      }
    }

    // 5. Log the attempt
    db.add event_log {
      data = {
        action  : "feedback_sms_sent"
        metadata: {
        job_id        : $input.job_id
        customer_phone: $input.customer_phone
        routed_through: "send_sms"
        send_success  : $send_ok
        gated         : $send_gated
      }
      }
    }
  }

  response = {success: true}
  guid = "N2Y0ZrsufypgQ-n8QfwGe1gFub0"
}
