// Parallel ANT Phase 1 — single intake endpoint for email-parser-sourced
// jobs (ServicePower, AHS, Allstate). Forward-only: rejects emails older
// than env.PARSER_ACTIVATION_TS_MS. Dedupes against existing parallel-mode
// rows by claim/dispatch number + phone last4. Creates with intake_source
// set, parallel_mode=true (assumed by the new system's filters), status
// 'needs_scheduled', scheduled_start null. Danielle assigns + schedules
// from needs-scheduled.html.
query create_job_from_email verb=POST {
  api_group = "intake"

  input {
    // Required: which parser sourced this
    text intake_source
  
    // Required: the email's received_at unix ms (parser supplies)
    int received_at_ms
  
    // Customer fields
    text? customer_first_name?
  
    text? customer_last_name?
    text? customer_phone?
    text? customer_email?
    text? service_address?
    text? service_city?
    text? service_state?
    text? service_zip?
  
    // Job fields
    text? appliance_type?
  
    text? brand?
    text? model_number?
    text? problem_summary?
    text? warranty_company?
    text? claim_number?
    text? dispatch_number?
  
    // Tells caller to log-only without inserting (smoke tests)
    bool? dry_run?
  }

  stack {
    // Gate 1: EMAIL_INTAKE_ENABLED
    var $intake_enabled_str {
      value = (($env.EMAIL_INTAKE_ENABLED ?? "false")|lower)
    }
  
    var $intake_enabled {
      value = ($intake_enabled_str == "true")
    }
  
    var $dry_run_flag {
      value = ($input.dry_run ?? false)
    }
  
    conditional {
      if (!$intake_enabled && !$dry_run_flag) {
        db.add event_log {
          data = {
            action  : "create_job_from_email_disabled"
            metadata: {
            intake_source: ($input.intake_source ?? "")
            reason       : "EMAIL_INTAKE_ENABLED=false"
          }
          }
        } as $disabled_log
      
        return {
          value = {
            success: false
            error  : "EMAIL_INTAKE_ENABLED=false"
            gated  : true
          }
        }
      }
    }
  
    // Gate 2: forward-only — reject if email older than parser activation
    var $activation_ts {
      value = (($env.PARSER_ACTIVATION_TS_MS ?? "0")|to_int)
    }
  
    conditional {
      if ($activation_ts > 0 && $input.received_at_ms < $activation_ts) {
        db.add event_log {
          data = {
            action  : "create_job_from_email_rejected_pre_activation"
            metadata: {
            intake_source : ($input.intake_source ?? "")
            received_at_ms: $input.received_at_ms
            activation_ms : $activation_ts
          }
          }
        } as $reject_log
      
        return {
          value = {success: false, error: "email_pre_activation"}
        }
      }
    }
  
    // Validate required intake_source enum
    var $intake_src_clean {
      value = (($input.intake_source ?? "")|trim|lower)
    }
  
    var $allowed_sources_csv {
      value = "|email_servicepower|email_ahs|email_allstate|web_chat|manual|"
    }
  
    var $src_marker {
      value = ("|" ~ $intake_src_clean ~ "|")
    }
  
    var $src_strip {
      value = $allowed_sources_csv|replace:$src_marker:""
    }
  
    var $src_valid {
      value = ($intake_src_clean != "") && (($allowed_sources_csv|strlen) > ($src_strip|strlen))
    }
  
    precondition ($src_valid) {
      error_type = "inputerror"
      error = "invalid intake_source"
    }
  
    // Phone normalize for dedup
    var $phone_in {
      value = (($input.customer_phone ?? "")|trim)
    }
  
    var $phone_digits {
      value = $phone_in
        |replace:"+":""
        |replace:"-":""
        |replace:"(":""
        |replace:")":""
        |replace:" ":""
    }
  
    var $phone_len {
      value = $phone_digits|strlen
    }
  
    var $last10_start {
      value = $phone_len - 10
    }
  
    var $phone_last10 {
      value = ($phone_len >= 10) ? ($phone_digits|substr:$last10_start) : $phone_digits
    }
  
    // Claim/dispatch # for dedup
    var $claim_trimmed {
      value = (($input.claim_number ?? "")|trim)
    }
  
    var $disp_trimmed {
      value = (($input.dispatch_number ?? "")|trim)
    }
  
    var $claim_or_disp {
      value = ($claim_trimmed != "") ? $claim_trimmed : $disp_trimmed
    }
  
    // Dedup: any existing job with matching claim OR matching phone_last4 + city
    var $dedup_found {
      value = false
    }
  
    var $dedup_job_id {
      value = 0
    }
  
    conditional {
      if ($claim_or_disp != "") {
        db.query jobs {
          where = $db.jobs.claim_number == $claim_or_disp
          sort = {jobs.id: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $by_claim
      
        var $bc_count {
          value = $by_claim.items|count
        }
      
        conditional {
          if ($bc_count > 0) {
            var.update $dedup_found {
              value = true
            }
          
            var $bc_first {
              value = $by_claim.items|get:0
            }
          
            var.update $dedup_job_id {
              value = $bc_first.id
            }
          }
        }
      }
    }
  
    conditional {
      if ($dedup_found) {
        db.add event_log {
          data = {
            action  : "create_job_from_email_dedup_skip"
            metadata: {
            intake_source: $intake_src_clean
            existing_job : $dedup_job_id
            claim_number : $claim_or_disp
          }
          }
        } as $dedup_log
      
        return {
          value = {
            success        : true
            action         : "dedup_skip"
            existing_job_id: $dedup_job_id
          }
        }
      }
    }
  
    // Dry run — log without inserting
    conditional {
      if ($dry_run_flag) {
        db.add event_log {
          data = {
            action  : "create_job_from_email_dry_run"
            metadata: {
            intake_source   : $intake_src_clean
            customer_phone  : $phone_last10
            warranty_company: (($input.warranty_company ?? "")|trim)
            claim_number    : $claim_or_disp
          }
          }
        } as $dry_log
      
        return {
          value = {success: true, action: "dry_run_logged"}
        }
      }
    }
  
    // Find/create customer by phone match (or just create new)
    var $cust_id_final {
      value = 0
    }
  
    conditional {
      if ($phone_last10 != "") {
        db.query customer {
          where = $db.customer.phone == $phone_in || $db.customer.phone == $phone_last10 || $db.customer.phone == ("+1" ~ $phone_last10)
          sort = {customer.id: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $cust_rows
      
        var $cust_count {
          value = $cust_rows.items|count
        }
      
        conditional {
          if ($cust_count > 0) {
            var $cust_first {
              value = $cust_rows.items|get:0
            }
          
            var.update $cust_id_final {
              value = $cust_first.id
            }
          }
        }
      }
    }
  
    // Create customer if missing
    conditional {
      if ($cust_id_final == 0) {
        db.add customer {
          data = {
            first_name: (($input.customer_first_name ?? "")|trim)
            last_name : (($input.customer_last_name ?? "")|trim)
            phone     : ($phone_in != "") ? $phone_in : $phone_last10
            email     : (($input.customer_email ?? "")|trim)
            address   : (($input.service_address ?? "")|trim)
            city      : (($input.service_city ?? "")|trim)
            state     : (($input.service_state ?? "")|trim)
            zip       : (($input.service_zip ?? "")|trim)
          }
        } as $new_cust
      
        var.update $cust_id_final {
          value = $new_cust.id
        }
      }
    }
  
    // Create the job. NOTE: jobs.intake_source + jobs.parallel_mode
    // columns must be added by operator via Xano UI (separate todo).
    // Until then, the "parallel" marker is the event_log row written
    // below — list_needs_scheduled_parallel scans for that action.
    db.add jobs {
      data = {
        customer_id      : $cust_id_final
        appliance_type   : (($input.appliance_type ?? "")|trim)
        brand            : (($input.brand ?? "")|trim)
        model_number     : (($input.model_number ?? "")|trim)
        problem_summary  : (($input.problem_summary ?? "")|trim)
        warranty_company : (($input.warranty_company ?? "")|trim)
        claim_number     : $claim_or_disp
        customer_type    : "warranty"
        scheduling_status: "not_ready"
        current_status   : "needs_scheduled"
        service_address  : (($input.service_address ?? "")|trim)
        service_city     : (($input.service_city ?? "")|trim)
        service_state    : (($input.service_state ?? "")|trim)
        service_zip      : (($input.service_zip ?? "")|trim)
      }
    } as $new_job
  
    db.add event_log {
      data = {
        action  : "parallel_job_created_from_email"
        metadata: {
        job_id          : $new_job.id
        customer_id     : $cust_id_final
        intake_source   : $intake_src_clean
        warranty_company: (($input.warranty_company ?? "")|trim)
        claim_number    : $claim_or_disp
      }
      }
    } as $create_log

    // Seed a TDR from the customer's intake info so the warranty package starts
    // pre-filled — the customer helps with the process, the tech has the final
    // say. System seed (technician_id=0); Teddy's pre-diag and the tech's own
    // TDR are later/newer rows that supersede it as "latest". status is left
    // unset on purpose (it's an enum — don't risk an invalid value).
    db.add technician_decision_report {
      data = {
        job_id           : $new_job.id
        technician_id    : 0
        diagnosis        : (($input.problem_summary ?? "")|trim)
        technician_notes : ("Customer-reported at intake. Machine: " ~ (($input.brand ?? "")|trim) ~ " " ~ (($input.appliance_type ?? "")|trim) ~ " model " ~ (($input.model_number ?? "")|trim) ~ ". Pending tech confirmation.")|trim
      }
    } as $seed_tdr

    // Emit JOB_CREATED so job_created.js agent fires the customer
    // intake-greeting SMS (gated by CUSTOMER_FACING_ENABLED).
    // 2026-06-01 — closes the gap where consolidated-path jobs didn't
    // get the auto-fired customer SMS (Step 1 of Teddy-alone office).
    var $jc_phone {
      value = (($input.customer_phone ?? "")|trim)
    }
  
    var $jc_first {
      value = (($input.customer_first_name ?? "")|trim)
    }
  
    var $jc_appliance {
      value = (($input.appliance_type ?? "")|trim)
    }
  
    var $jc_payload_obj {
      value = {
        job_id             : $new_job.id
        customer_phone     : $jc_phone
        customer_first_name: $jc_first
        appliance_type     : $jc_appliance
        customer_type      : "warranty"
        source             : $intake_src_clean
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
  
    // SMS Danielle (615-485-0713) — internal recipient, bypasses CUSTOMER_FACING gate.
    var $dn_warranty {
      value = (($input.warranty_company ?? "warranty")|trim)
    }
  
    var $dn_first {
      value = (($input.customer_first_name ?? "")|trim)
    }
  
    var $dn_last {
      value = (($input.customer_last_name ?? "")|trim)
    }
  
    var $dn_city {
      value = (($input.service_city ?? "")|trim)
    }
  
    var $dn_full_name {
      value = (($dn_first ~ " " ~ $dn_last)|trim)
    }
  
    var $danielle_body {
      value = "[ant] new " ~ $dn_warranty ~ " job in Needs Scheduled: " ~ $dn_full_name ~ ", " ~ $dn_city ~ ". tnapplianceexchange.net/needs-scheduled.html"
    }
  
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      params = {
        to         : "+16154850713"
        message    : $danielle_body
        context_tag: "parallel_intake_danielle_alert"
      }
    
      headers = []
        |push:"Content-Type: application/json"
    } as $danielle_alert
  }

  response = {
    success      : true
    action       : "created"
    job_id       : $new_job.id
    customer_id  : $cust_id_final
    intake_source: $intake_src_clean
  }

  guid = "create-job-from-email-v1"
}