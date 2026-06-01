// One-tap "accept Claude's voicemail draft and create the job" endpoint.
// Called from Office Today voicemail card. Reads the persisted draft from
// event_log (voicemail_draft_<source_event_log_id>), matches or creates
// a customer by phone, creates the job, and writes an audit row.
//
// Returns job_id so the UI can deep-link straight to job-detail.
query create_job_from_voicemail verb=POST {
  api_group = "intake"

  input {
    int source_event_log_id
    text? first_name_override?
    text? appliance_override?
    text? problem_override?
  }

  stack {
    precondition ($input.source_event_log_id > 0) {
      error_type = "inputerror"
      error = "source_event_log_id required"
    }

    var $draft_key {
      value = "voicemail_draft_" ~ ($input.source_event_log_id|to_text)
    }

    db.query event_log {
      where = $db.event_log.action == $draft_key
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $draft_rows

    var $draft_row {
      value = (($draft_rows.items|first) ?? null)
    }

    precondition ($draft_row != null) {
      error_type = "notfound"
      error = "voicemail_draft row not found for source_event_log_id"
    }

    var $draft_meta {
      value = $draft_row.metadata
    }

    var $draft {
      value = ($draft_meta.draft ?? null)
    }

    precondition ($draft != null) {
      error_type = "notfound"
      error = "draft missing from event_log metadata"
    }

    var $caller_phone {
      value = (($draft_meta.caller_phone ?? "")|trim)
    }

    var $first_name_override {
      value = (($input.first_name_override ?? "")|trim)
    }

    var $appliance_override {
      value = (($input.appliance_override ?? "")|trim)
    }

    var $problem_override {
      value = (($input.problem_override ?? "")|trim)
    }

    var $first_name {
      value = ($first_name_override != "") ? $first_name_override : (($draft.first_name ?? "")|trim)
    }

    var $appliance {
      value = ($appliance_override != "") ? $appliance_override : (($draft.appliance_type ?? "")|trim)
    }

    var $problem {
      value = ($problem_override != "") ? $problem_override : (($draft.problem_summary ?? "")|trim)
    }

    var $brand {
      value = (($draft.brand ?? "")|trim)
    }

    var $zip {
      value = (($draft.zip ?? "")|trim)
    }

    var $city {
      value = (($draft.city ?? "")|trim)
    }

    var $first_name_clean {
      value = ($first_name != "") ? $first_name : "Voicemail caller"
    }

    // Match-or-create customer by phone
    var $existing_cust {
      value = null
    }

    conditional {
      if ($caller_phone != "") {
        db.query customer {
          where = $db.customer.phone == $caller_phone
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $existing_rows

        var.update $existing_cust {
          value = (($existing_rows.items|first) ?? null)
        }
      }
    }

    var $cust_id {
      value = 0
    }

    conditional {
      if ($existing_cust != null) {
        var.update $cust_id {
          value = $existing_cust.id
        }
      }

      else {
        db.add customer {
          data = {
            first_name : $first_name_clean
            phone      : $caller_phone
            zip        : $zip
            city       : $city
            state      : "TN"
            company_id : 1
          }
        } as $new_cust

        var.update $cust_id {
          value = $new_cust.id
        }
      }
    }

    var $now_ms {
      value = (now|to_ms)
    }

    // Create job — parallel_mode jobs land in the office's needs-scheduled
    // queue per the HCP-kill week plan
    db.add jobs {
      data = {
        customer_id       : $cust_id
        customer_type     : "self_pay"
        appliance_type    : $appliance
        brand             : $brand
        problem_summary   : $problem
        intake_source     : "voicemail"
        scheduling_status : "not_ready"
        parallel_mode     : true
        company_id        : 1
        notes             : ("Created from voicemail draft (event_log #" ~ ($input.source_event_log_id|to_text) ~ ")")
      }
    } as $new_job

    // Mark the original voicemail "cleared" so it drops off the queue
    db.add event_log {
      data = {
        action  : ("vapi_voicemail_cleared_" ~ ($input.source_event_log_id|to_text))
        metadata: {
          source_event_log_id: $input.source_event_log_id
          cleared_via        : "voicemail_draft_accepted"
          created_job_id     : $new_job.id
          created_customer_id: $cust_id
          cleared_at_ms      : $now_ms
        }
      }
    } as $clear_audit

    db.add event_log {
      data = {
        action  : "voicemail_job_created"
        metadata: {
          job_id             : $new_job.id
          customer_id        : $cust_id
          source_event_log_id: $input.source_event_log_id
          draft              : $draft
        }
      }
    } as $create_audit
  }

  response = {
    success    : true
    job_id     : $new_job.id
    customer_id: $cust_id
    job_detail_url: ("https://tnapplianceexchange.net/job-detail.html?job_id=" ~ ($new_job.id|to_text))
  }

  guid = "create-job-from-voicemail-v1"
}
