query warranty_job_intake verb=POST {
  api_group = "intake"

  input {
    // Raw JSON request payload from Jotform
    text rawRequest
  }

  stack {
    // Step 1: Parse rawRequest using json_decode, store as "parsed"
    var $parsed {
      value = $input.rawRequest|json_decode
    }
  
    // Step 2-15: Create variables from parsed
    var $first_name {
      value = $parsed.q3_customerName.first
    }
  
    var $last_name {
      value = $parsed.q3_customerName.last
    }
  
    var $phone {
      value = $parsed.q4_phoneNumber.full
    }
  
    var $email {
      value = $parsed.q5_email
    }
  
    var $appliance_type {
      value = $parsed.q6_applianceType
    }
  
    var $brand {
      value = $parsed.q7_applianceBrand
    }
  
    var $model_number {
      value = $parsed.q8_modelNumber
    }
  
    var $problem_summary {
      value = $parsed.q9_whatIssue
    }
  
    var $warranty_company {
      value = $parsed.q26_warrantyCompany
    }
  
    var $claim_number {
      value = $parsed.q27_claim
    }
  
    var $zip {
      value = $parsed.q20_zipCode
    }
  
    var $state {
      value = $parsed.q21_state
    }
  
    var $address {
      value = $parsed.q23_streetAddress
    }
  
    var $city {
      value = $parsed.q24_city
    }
  
    var $scheduling_notes {
      value = $parsed.q25_schedulingNotes
    }
  
    var $submission_id {
      value = $parsed.slug
    }
  
    // Step 16: Query customer table by phone to check for existing customer
    db.get customer {
      field_name = "phone"
      field_value = $phone
    } as $existing_customer
  
    // Step 17: Conditional - if no existing customer create new customer record
    conditional {
      if ($existing_customer == null) {
        db.add customer {
          data = {
            first_name: $first_name
            last_name : $last_name
            phone     : $phone
            email     : $email
            address   : $address
            city      : $city
            state     : $state
            zip       : $zip
          }
        } as $new_customer
      
        var $customer_id {
          value = $new_customer.id
        }
      }
    
      else {
        var $customer_id {
          value = $existing_customer.id
        }
      }
    }
  
    // Step 18: Add Record to jobs table
    db.add jobs {
      data = {
        customer_id       : $customer_id
        appliance_type    : $appliance_type
        brand             : $brand
        model_number      : $model_number
        problem_summary   : $problem_summary
        warranty_company  : $warranty_company
        claim_number      : $claim_number
        form_submission_id: $submission_id
        job_number        : null
        current_status    : "new_intake"
        friendly_status   : "New Intake"
        job_status        : "submitted"
        triage_status     : "not_reviewed"
        parts_status      : "not_needed"
        scheduling_status : "not_ready"
        payment_status    : "unpaid"
        source_type       : "Jotform"
        source_agent      : "webhook"
        customer_type     : "warranty"
        notes_internal    : $scheduling_notes
      }
    } as $new_job
  
    // Step 19: Add Record to job_financial
    db.add job_financial {
      data = {
        job_id        : $new_job.id
        payment_status: "warranty_pending"
      }
    } as $new_financial
  
    // Step 20: Add Record to job_event
    db.add job_event {
      data = {
        job_id      : $new_job.id
        event_type  : "intake_created"
        event_source: "Jotform Webhook"
        event_notes : "Warranty job intake created via Jotform submission"
        created_by  : "system"
      }
    } as $new_event
  
    // Phase B: emit JOB_CREATED for colony loop greeting (see docs/colony-loop-design.md section 16).
    // Also satisfies Q5 - this endpoint previously wrote zero event_log rows.
    var $jc_phone {
      value = $phone
    }
  
    var $jc_first {
      value = $first_name
    }
  
    var $jc_appliance {
      value = ($appliance_type ?? "")
    }
  
    var $jc_payload_obj {
      value = {
        job_id             : $new_job.id
        customer_phone     : $jc_phone
        customer_first_name: $jc_first
        appliance_type     : $jc_appliance
        source             : "warranty_jotform"
      }
    }
  
    var $jc_payload_str {
      value = $jc_payload_obj|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "JOB_CREATED"
        signal_strength: 70
        source_colony  : ""
        target_colonies: ""
        payload        : $jc_payload_str
      }
    } as $jc_signal
  
    db.add event_log {
      data = {
        action  : "job_created_signal_emitted"
        metadata: {
        job_id   : $new_job.id
        signal_id: $jc_signal.id
        source   : "warranty_jotform"
      }
      }
    } as $jc_log
  }

  response = $new_job
  guid = "je93Hmzrtt6mZDxGsNnKTxRPCOY"
}