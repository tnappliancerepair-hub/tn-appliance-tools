// Brooke calls this DURING a Vapi call when a customer wants to
// schedule a new repair. Creates the customer (if new) + the job ticket
// + emits JOB_CREATED so every downstream chain fires (greeting SMS,
// auto-schedule consideration, office-today queue, etc.). Auto-tagged
// with source='vapi_inbound_call' so the call gets linked back.
query create_job_from_call verb=POST {
  api_group = "intake"

  input {
    text customer_first_name
    text? customer_last_name?
    text customer_phone
    text? customer_email?
    text? customer_address?
    text? customer_city?
    text? customer_state?
    text? customer_zip?
    text appliance_type
    text? appliance_brand?
    text? appliance_model?
    text problem_summary
    text? customer_type?
    text? warranty_company?
    text? vapi_call_id?
    text? preferred_time_text?
  }

  stack {
    precondition (($input.customer_first_name ?? "")|trim != "") {
      error_type = "inputerror"
      error = "customer_first_name required"
    }
    precondition (($input.customer_phone ?? "")|trim != "") {
      error_type = "inputerror"
      error = "customer_phone required"
    }
    precondition (($input.problem_summary ?? "")|trim != "") {
      error_type = "inputerror"
      error = "problem_summary required"
    }

    var $phone_clean { value = ($input.customer_phone|trim) }
    var $first_clean { value = ($input.customer_first_name|trim) }
    var $last_clean { value = (($input.customer_last_name ?? "")|trim) }
    var $email_clean { value = (($input.customer_email ?? "")|trim) }
    var $address_clean { value = (($input.customer_address ?? "")|trim) }
    var $city_clean { value = (($input.customer_city ?? "")|trim) }
    var $state_clean { value = (($input.customer_state ?? "")|trim) }
    var $zip_clean { value = (($input.customer_zip ?? "")|trim) }
    var $type_clean { value = ($input.appliance_type|trim) }
    var $brand_clean { value = (($input.appliance_brand ?? "")|trim) }
    var $model_clean { value = (($input.appliance_model ?? "")|trim) }
    var $problem_clean { value = $input.problem_summary|trim }
    var $cust_type_clean { value = (($input.customer_type ?? "self_pay")|trim) }
    var $warranty_clean { value = (($input.warranty_company ?? "")|trim) }
    var $vapi_id_clean { value = (($input.vapi_call_id ?? "")|trim) }
    var $pref_time_clean { value = (($input.preferred_time_text ?? "")|trim) }

    // Find or create customer by phone
    db.query customer {
      where = $db.customer.phone == $phone_clean
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $cust_rows

    var $existing_cust { value = (($cust_rows.items|first) ?? null) }
    var $customer_id { value = ($existing_cust == null) ? 0 : $existing_cust.id }

    conditional {
      if ($customer_id == 0) {
        db.add customer {
          data = {
            first_name : $first_clean
            last_name  : $last_clean
            phone      : $phone_clean
            email      : $email_clean
            address    : $address_clean
            city       : $city_clean
            state      : $state_clean
            zip_code   : $zip_clean
          }
        } as $new_cust
        var.update $customer_id { value = $new_cust.id }
      }
    }

    db.add jobs {
      data = {
        customer_id        : $customer_id
        appliance_type     : $type_clean
        appliance_brand    : $brand_clean
        appliance_model    : $model_clean
        problem_summary    : $problem_clean
        customer_type      : $cust_type_clean
        warranty_company   : $warranty_clean
        scheduling_status  : "not_ready"
        current_status     : "new_intake"
        source_type        : "vapi_inbound_call"
        customer_preference_text: $pref_time_clean
        parallel_mode      : true
        intake_source      : "vapi_inbound_call"
      }
    } as $new_job

    // Emit JOB_CREATED so all the downstream chains fire — greeting,
    // auto-schedule consideration, office-today queue, etc.
    var $job_payload {
      value = ({job_id: $new_job.id, customer_id: $customer_id, source: "vapi_inbound_call", vapi_call_id: $vapi_id_clean, appliance_type: $type_clean, customer_first_name: $first_clean, customer_phone: $phone_clean, problem_summary: $problem_clean, created_at_ms: (now|to_ms)}|json_encode)
    }
    db.add colony_signals {
      data = {
        signal_type     : "JOB_CREATED"
        signal_strength : 80
        source_colony   : "intake"
        target_colonies : ""
        payload         : $job_payload
      }
    }

    db.add event_log {
      data = {
        action  : "job_created_from_vapi_call"
        metadata: ({job_id: $new_job.id, customer_id: $customer_id, vapi_call_id: $vapi_id_clean, appliance_type: $type_clean, problem_summary: $problem_clean, ts_ms: (now|to_ms)}|json_encode)
      }
    }
  }

  response = {
    success     : true
    job_id      : $new_job.id
    customer_id : $customer_id
    ack         : ("Job ticket #" ~ ($new_job.id|to_text) ~ " created. Office will reach out to schedule the visit.")
  }

  guid = "create-job-from-call-v1"
}
