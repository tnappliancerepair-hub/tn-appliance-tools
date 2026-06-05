// Persists a $50 Quick Check submission AND creates a corresponding
// cash-customer job + customer record so Teddy can immediately open
// it in Teddy Tool and act on the lead.
//
// Flow:
//   1. Match or create the customer (by email if available, phone fallback)
//   2. Create a job tagged source=quick_check_lead, customer_type=cash
//      with the AI-generated diagnosis pre-populated
//   3. Log the full submission + result to event_log
//   4. Emit QUICK_CHECK_SUBMITTED signal with job_id so the agent
//      can SMS Teddy a direct Teddy Tool link
//
// Returns job_id so the client knows where the lead landed.
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
    var $phone_raw { value = (($input.phone ?? "")|trim) }
    var $appl_clean { value = (($input.appliance_type ?? "")|trim) }
    var $brand_clean { value = (($input.brand ?? "")|trim) }
    var $model_clean { value = (($input.model ?? "")|trim) }
    var $problem_clean { value = (($input.problem_summary ?? "")|trim) }
    var $zip_clean { value = (($input.zip ?? "")|trim) }
    var $had_photo_b { value = ($input.had_photo ?? false) }
    var $result_clean { value = (($input.result_json ?? "{}")|trim) }
    var $now_ms { value = now|to_ms }

    // Normalize phone to E.164-ish digits-only for matching
    var $phone_digits {
      value = $phone_raw|replace:"+":""|replace:"-":""|replace:" ":""|replace:"(":""|replace:")":""
    }
    var $phone_e164 {
      value = ($phone_digits == "") ? "" : (($phone_digits|substr:0:1 == "1") ? ("+" ~ $phone_digits) : ("+1" ~ $phone_digits))
    }

    // Split name into first/last for customer record (best effort)
    var $first_name {
      value = (($name_clean|split:" ")|first) ?? ""
    }
    var $last_name {
      value = ($name_clean|substr:(($first_name|length) + 1):200)|trim
    }

    // Try to match an existing customer by email first
    var $matched_customer_id { value = 0 }
    conditional {
      if ($email_clean != "") {
        db.query customer {
          where = $db.customer.email == $email_clean
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $email_match
        var $email_match_first { value = (($email_match.items|first) ?? null) }
        conditional {
          if ($email_match_first != null) {
            var.update $matched_customer_id { value = $email_match_first.id }
          }
        }
      }
    }
    // Fallback to phone match if email didn't find one
    conditional {
      if ($matched_customer_id == 0 && $phone_e164 != "") {
        db.query customer {
          where = $db.customer.phone == $phone_e164
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $phone_match
        var $phone_match_first { value = (($phone_match.items|first) ?? null) }
        conditional {
          if ($phone_match_first != null) {
            var.update $matched_customer_id { value = $phone_match_first.id }
          }
        }
      }
    }

    // Create new customer if no match found
    conditional {
      if ($matched_customer_id == 0) {
        db.add customer {
          data = {
            first_name: $first_name
            last_name : $last_name
            email     : $email_clean
            phone     : $phone_e164
            zip_code  : $zip_clean
          }
        } as $created_customer
        var.update $matched_customer_id { value = $created_customer.id }
      }
    }

    // Build the job's problem_summary including the AI verdict so it
    // surfaces immediately on Teddy Tool / office views.
    var $job_problem {
      value = ($problem_clean == "") ? "(Quick Check submission - see notes)" : $problem_clean
    }

    // Create the job. customer_type=cash so it routes into the cash
    // customer flow (not warranty pipeline). intake_source=quick_check
    // so office can filter / find these in the queue.
    db.add jobs {
      data = {
        customer_id      : $matched_customer_id
        customer_type    : "cash"
        appliance_type   : $appl_clean
        appliance_brand  : $brand_clean
        model_number     : $model_clean
        problem_summary  : $job_problem
        current_status   : "lead"
        scheduling_status: "not_ready"
        parallel_mode    : true
        intake_source    : "quick_check"
        source_type      : "quick_check_web"
        source_agent     : "ai_quick_check"
      }
    } as $created_job

    var $job_id { value = $created_job.id }

    // Log the full submission for corpus + audit
    db.add event_log {
      data = {
        action  : "quick_check_submitted"
        metadata: ({job_id: $job_id, customer_id: $matched_customer_id, customer_name: $name_clean, email: $email_clean, phone: $phone_e164, appliance_type: $appl_clean, brand: $brand_clean, model: $model_clean, problem_summary: $problem_clean, zip: $zip_clean, had_photo: $had_photo_b, ts_ms: $now_ms, result: $result_clean}|json_encode)
      }
    }

    // Emit the colony signal with job_id included so the lead-alert
    // agent can build a direct Teddy Tool link in the SMS.
    var $payload_str {
      value = ({job_id: $job_id, customer_id: $matched_customer_id, customer_name: $name_clean, email: $email_clean, phone: $phone_e164, appliance_type: $appl_clean, brand: $brand_clean, model: $model_clean, problem_summary: $problem_clean, zip: $zip_clean, had_photo: $had_photo_b, result_json: $result_clean, ts_ms: $now_ms}|json_encode)
    }
    db.add colony_signals {
      data = {
        signal_type     : "QUICK_CHECK_SUBMITTED"
        signal_strength : 85
        source_colony   : "consumer_intake"
        target_colonies : ""
        payload         : $payload_str
      }
    }
  }

  response = {
    success: true
    job_id : $job_id
    customer_id: $matched_customer_id
    received_at_ms: $now_ms
    ack: "Got it - we will follow up if needed."
  }

  guid = "save-quick-check-submission-v2"
}
