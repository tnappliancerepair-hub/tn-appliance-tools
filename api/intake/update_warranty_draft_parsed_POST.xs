// Receives Claude-extracted fields from parse-warranty-drafts.js and
// writes them to the customer + job records. Idempotent — if customer
// already has a real first_name (not the placeholder), skips that side
// so a human override isn't clobbered.
query update_warranty_draft_parsed verb=POST {
  api_group = "intake"

  input {
    int job_id
    int customer_id
    text? first_name?
    text? last_name?
    text? phone?
    text? address?
    text? city?
    text? state?
    text? zip?
    text? appliance_type?
    text? brand?
    text? model_number?
    text? problem_description?
    text? claim_number?
    text? dispatch_number?
    text? scheduled_date_iso?
  }

  stack {
    precondition ($input.job_id > 0 && $input.customer_id > 0) {
      error_type = "inputerror"
      error      = "job_id + customer_id required"
    }

    db.get customer {
      field_name = "id"
      field_value = $input.customer_id
    } as $cust

    var $existing_first {
      value = (($cust.first_name|to_text) ?? "")
    }

    var $is_placeholder {
      value = $existing_first == "(Pending review)" || $existing_first == ""
    }

    conditional {
      if ($is_placeholder) {
        db.edit customer {
          field_name = "id"
          field_value = $input.customer_id
          data = {
            first_name: (($input.first_name|to_text) ?? "")
            last_name : (($input.last_name|to_text) ?? "")
            phone     : (($input.phone|to_text) ?? "")
            address   : (($input.address|to_text) ?? "")
            city      : (($input.city|to_text) ?? "")
            state     : (($input.state|to_text) ?? "")
            zip       : (($input.zip|to_text) ?? "")
          }
        }
      }
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        appliance_type   : ((($input.appliance_type|to_text) ?? "") != "") ? (($input.appliance_type|to_text) ?? "") : (($job.appliance_type|to_text) ?? "")
        brand            : ((($input.brand|to_text) ?? "") != "") ? (($input.brand|to_text) ?? "") : (($job.brand|to_text) ?? "")
        model_number     : ((($input.model_number|to_text) ?? "") != "") ? (($input.model_number|to_text) ?? "") : (($job.model_number|to_text) ?? "")
        problem_summary  : ((($input.problem_description|to_text) ?? "") != "") ? (($input.problem_description|to_text) ?? "") : (($job.problem_summary|to_text) ?? "")
        claim_number     : ((($input.claim_number|to_text) ?? "") != "") ? (($input.claim_number|to_text) ?? "") : (($job.claim_number|to_text) ?? "")
        dispatch_source_id: ((($input.dispatch_number|to_text) ?? "") != "") ? (($input.dispatch_number|to_text) ?? "") : (($job.dispatch_source_id|to_text) ?? "")
        service_address  : ((($input.address|to_text) ?? "") != "") ? (($input.address|to_text) ?? "") : (($job.service_address|to_text) ?? "")
        service_city     : ((($input.city|to_text) ?? "") != "") ? (($input.city|to_text) ?? "") : (($job.service_city|to_text) ?? "")
        service_state    : ((($input.state|to_text) ?? "") != "") ? (($input.state|to_text) ?? "") : (($job.service_state|to_text) ?? "")
        service_zip      : ((($input.zip|to_text) ?? "") != "") ? (($input.zip|to_text) ?? "") : (($job.service_zip|to_text) ?? "")
      }
    }

    db.add event_log {
      data = {
        action  : "warranty_draft_parsed"
        metadata: ```
          {
            job_id        : $input.job_id
            customer_id   : $input.customer_id
            had_placeholder: $is_placeholder
          }|json_encode
          ```
      }
    }

    // 2026-06-02 — emit JOB_CREATED so the colony loop's job_created.js
    // picks it up and texts the customer their portal link. Only fires
    // when (a) we just upgraded the placeholder to real info AND (b) we
    // have a phone to text. Without these guards we'd text "(Pending
    // review)" / no phone / wasted send.
    var $phone_in {
      value = (($input.phone|to_text) ?? "")
    }

    var $first_in {
      value = (($input.first_name|to_text) ?? "")
    }

    var $should_emit {
      value = $is_placeholder && $phone_in != "" && $first_in != ""
    }

    conditional {
      if ($should_emit) {
        db.get jobs {
          field_name = "id"
          field_value = $input.job_id
        } as $job_after

        var $payload_str {
          value = ```
            {
              job_id              : $input.job_id
              customer_id         : $input.customer_id
              customer_first_name : $first_in
              phone               : $phone_in
              appliance_type      : (($job_after.appliance_type|to_text) ?? "")
              source              : "email_generic_warranty"
              customer_type       : "warranty"
              warranty_company    : (($job_after.warranty_company|to_text) ?? "")
            }|json_encode
            ```
        }

        db.add colony_signals {
          data = {
            signal_type    : "JOB_CREATED"
            signal_strength: 70
            source_colony  : "warranty_draft_parsed"
            target_colonies: ""
            payload        : $payload_str
          }
        }
      }
    }
  }

  response = {
    success      : true
    job_id       : $input.job_id
    customer_id  : $input.customer_id
    updated_cust : $is_placeholder
  }

  guid = "update-warranty-draft-parsed-v1"
}
