// Logs a consumer Quick Check submission. Captures the customer input
// + the AI-generated answer for later review + corpus building.
// Emits a colony signal so office can see fresh consumer leads.
query save_quick_check_submission verb=POST {
  api_group = "intake"

  input {
    text? customer_name?
    text? email?
    text? phone?
    text? appliance_type?
    text? brand?
    text? model?
    text? problem_summary?
    text? zip?
    bool? had_photo?
    text? result_json?
  }

  stack {
    var $name_clean { value = (($input.customer_name ?? "")|trim) }
    var $email_clean { value = (($input.email ?? "")|trim) }
    var $phone_clean { value = (($input.phone ?? "")|trim) }
    var $appl_clean { value = (($input.appliance_type ?? "")|trim) }
    var $brand_clean { value = (($input.brand ?? "")|trim) }
    var $model_clean { value = (($input.model ?? "")|trim) }
    var $problem_clean { value = (($input.problem_summary ?? "")|trim) }
    var $zip_clean { value = (($input.zip ?? "")|trim) }
    var $had_photo_b { value = ($input.had_photo ?? false) }
    var $result_clean { value = (($input.result_json ?? "{}")|trim) }
    var $now_ms { value = now|to_ms }

    db.add event_log {
      data = {
        action  : "quick_check_submitted"
        metadata: ({customer_name: $name_clean, email: $email_clean, phone: $phone_clean, appliance_type: $appl_clean, brand: $brand_clean, model: $model_clean, problem_summary: $problem_clean, zip: $zip_clean, had_photo: $had_photo_b, ts_ms: $now_ms, result: $result_clean}|json_encode)
      }
    }

    // Emit a colony signal so a future agent can surface fresh consumer
    // leads on office-today + send Teddy an alert.
    var $payload_str {
      value = ({customer_name: $name_clean, email: $email_clean, phone: $phone_clean, appliance_type: $appl_clean, brand: $brand_clean, model: $model_clean, problem_summary: $problem_clean, zip: $zip_clean, ts_ms: $now_ms}|json_encode)
    }
    db.add colony_signals {
      data = {
        signal_type     : "QUICK_CHECK_SUBMITTED"
        signal_strength : 70
        source_colony   : "consumer_intake"
        target_colonies : ""
        payload         : $payload_str
      }
    }
  }

  response = {
    success: true
    received_at_ms: $now_ms
    ack: "Got it - we will follow up if needed."
  }

  guid = "save-quick-check-submission-v1"
}
