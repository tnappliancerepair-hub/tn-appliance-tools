// Parallel ANT Phase 1 intake endpoint - REWRITE 2026-05-30.
//
// Original had a silent runtime failure in the success path: db.add jobs
// succeeded but the subsequent event_log marker write + Danielle SMS
// did not fire (despite the response returning success). Diagnosed by
// the Day 2 closed-loop test on 2026-05-30 09:40 CT.
//
// This rewrite:
//   * Sets parallel_mode=true and intake_source directly on the jobs row
//     (jobs.parallel_mode + jobs.intake_source columns added 2026-05-30).
//   * Replaces the nested metadata block with separate $captured_* vars
//     populated BEFORE the event_log write, eliminating any
//     evaluation-order ambiguity.
//   * Replaces the headers = [] |push:"..." pattern with an inline
//     literal headers list.
//   * Preserves: EMAIL_INTAKE_ENABLED gate, PARSER_ACTIVATION_TS_MS
//     forward-only filter, dedup by claim_number, find-or-create
//     customer, dry-run path, Danielle SMS alert.
//
// XS rules: no em-dashes, no backticks, no try/catch, no raw if,
// every filter paren-wrapped, ?? only in value = (...).

query create_job_from_email verb=POST {
  api_group = "intake"

  input {
    text intake_source
    int received_at_ms

    text? customer_first_name?
    text? customer_last_name?
    text? customer_phone?
    text? customer_email?
    text? service_address?
    text? service_city?
    text? service_state?
    text? service_zip?

    text? appliance_type?
    text? brand?
    text? model_number?
    text? problem_summary?
    text? warranty_company?
    text? claim_number?
    text? dispatch_number?

    bool? dry_run?
  }

  stack {
    // ── Gate 1: EMAIL_INTAKE_ENABLED ─────────────────────────────
    var $intake_enabled_raw {
      value = (($env.EMAIL_INTAKE_ENABLED ?? "false")|lower)
    }

    var $intake_enabled {
      value = ($intake_enabled_raw == "true")
    }

    var $dry_run_flag {
      value = ($input.dry_run ?? false)
    }

    conditional {
      if ($intake_enabled != true && $dry_run_flag != true) {
        db.add event_log {
          data = {
            action: "create_job_from_email_disabled"
            metadata: {
              intake_source: ($input.intake_source ?? "")
              reason: "EMAIL_INTAKE_ENABLED=false"
            }
          }
        } as $disabled_log

        return {
          value = {
            success: false
            error: "EMAIL_INTAKE_ENABLED=false"
            gated: true
          }
        }
      }
    }

    // ── Gate 2: PARSER_ACTIVATION_TS_MS forward-only filter ──────
    var $activation_ts_raw {
      value = (($env.PARSER_ACTIVATION_TS_MS ?? "0")|to_int)
    }

    conditional {
      if ($activation_ts_raw > 0 && $input.received_at_ms < $activation_ts_raw && $dry_run_flag != true) {
        db.add event_log {
          data = {
            action: "create_job_from_email_pre_activation"
            metadata: {
              received_at_ms: $input.received_at_ms
              activation_ts: $activation_ts_raw
              intake_source: ($input.intake_source ?? "")
            }
          }
        } as $pre_act_log

        return {
          value = {
            success: false
            error: "email_pre_activation"
          }
        }
      }
    }

    // ── Validate intake_source enum ──────────────────────────────
    var $intake_src_clean {
      value = ((($input.intake_source ?? "")|trim)|lower)
    }

    var $allowed_sources_csv {
      value = "|email_servicepower|email_ahs|email_allstate|web_chat|manual|phone_call|"
    }

    var $src_marker {
      value = ("|" ~ $intake_src_clean ~ "|")
    }

    var $src_strip {
      value = ($allowed_sources_csv|replace:$src_marker:"")
    }

    var $src_valid {
      value = ($intake_src_clean != "") && (($allowed_sources_csv|strlen) > ($src_strip|strlen))
    }

    precondition ($src_valid == true) {
      error_type = "inputerror"
      error = "invalid intake_source"
    }

    // ── Phone normalize for dedup ────────────────────────────────
    var $phone_in {
      value = (($input.customer_phone ?? "")|trim)
    }

    var $phone_digits {
      value = ((((($phone_in|replace:"+":"")|replace:"-":"")|replace:"(":"")|replace:")":"")|replace:" ":"")
    }

    var $phone_len {
      value = ($phone_digits|strlen)
    }

    var $last10_start {
      value = ($phone_len - 10)
    }

    var $phone_last10 {
      value = ($phone_len >= 10) ? ($phone_digits|substr:$last10_start) : $phone_digits
    }

    // ── Claim / dispatch # for dedup ─────────────────────────────
    var $claim_trimmed {
      value = (($input.claim_number ?? "")|trim)
    }

    var $disp_trimmed {
      value = (($input.dispatch_number ?? "")|trim)
    }

    var $claim_or_disp {
      value = ($claim_trimmed != "") ? $claim_trimmed : $disp_trimmed
    }

    // ── Dedup ────────────────────────────────────────────────────
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

        var $bc_first {
          value = (($by_claim.items|first) ?? null)
        }

        conditional {
          if ($bc_first != null) {
            var.update $dedup_found {
              value = true
            }

            var.update $dedup_job_id {
              value = $bc_first.id
            }
          }
        }
      }
    }

    conditional {
      if ($dedup_found == true) {
        db.add event_log {
          data = {
            action: "create_job_from_email_dedup_skip"
            metadata: {
              intake_source: $intake_src_clean
              existing_job: $dedup_job_id
              claim_number: $claim_or_disp
            }
          }
        } as $dedup_log

        return {
          value = {
            success: true
            action: "dedup_skip"
            existing_job_id: $dedup_job_id
          }
        }
      }
    }

    // ── Dry run path ─────────────────────────────────────────────
    conditional {
      if ($dry_run_flag == true) {
        db.add event_log {
          data = {
            action: "create_job_from_email_dry_run"
            metadata: {
              intake_source: $intake_src_clean
              customer_phone: $phone_last10
              warranty_company: (($input.warranty_company ?? "")|trim)
              claim_number: $claim_or_disp
            }
          }
        } as $dry_log

        return {
          value = {
            success: true
            action: "dry_run_logged"
          }
        }
      }
    }

    // ── Find or create customer ──────────────────────────────────
    var $cust_id_final {
      value = 0
    }

    conditional {
      if ($phone_last10 != "") {
        var $phone_plus {
          value = ("+1" ~ $phone_last10)
        }

        db.query customer {
          where = $db.customer.phone == $phone_in || $db.customer.phone == $phone_last10 || $db.customer.phone == $phone_plus
          sort = {customer.id: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $cust_rows

        var $cust_first {
          value = (($cust_rows.items|first) ?? null)
        }

        conditional {
          if ($cust_first != null) {
            var.update $cust_id_final {
              value = $cust_first.id
            }
          }
        }
      }
    }

    conditional {
      if ($cust_id_final == 0) {
        var $phone_to_save {
          value = ($phone_in != "") ? $phone_in : $phone_last10
        }

        db.add customer {
          data = {
            first_name: (($input.customer_first_name ?? "")|trim)
            last_name: (($input.customer_last_name ?? "")|trim)
            phone: $phone_to_save
            email: (($input.customer_email ?? "")|trim)
            address: (($input.service_address ?? "")|trim)
            city: (($input.service_city ?? "")|trim)
            state: (($input.service_state ?? "")|trim)
            zip: (($input.service_zip ?? "")|trim)
          }
        } as $new_cust

        var.update $cust_id_final {
          value = $new_cust.id
        }
      }
    }

    // ── Create the job (parallel_mode + intake_source on the row) ────
    var $appliance_clean {
      value = (($input.appliance_type ?? "")|trim)
    }

    var $brand_clean {
      value = (($input.brand ?? "")|trim)
    }

    var $model_clean {
      value = (($input.model_number ?? "")|trim)
    }

    var $problem_clean {
      value = (($input.problem_summary ?? "")|trim)
    }

    var $warranty_clean {
      value = (($input.warranty_company ?? "")|trim)
    }

    var $service_addr_clean {
      value = (($input.service_address ?? "")|trim)
    }

    var $service_city_clean {
      value = (($input.service_city ?? "")|trim)
    }

    var $service_state_clean {
      value = (($input.service_state ?? "")|trim)
    }

    var $service_zip_clean {
      value = (($input.service_zip ?? "")|trim)
    }

    // XS dialect quirk: literal `true` in a db.add data block does not
    // get honored — the column lands as default false. Bind to a var first.
    var $parallel_mode_flag {
      value = true
    }

    db.add jobs {
      data = {
        customer_id: $cust_id_final
        appliance_type: $appliance_clean
        brand: $brand_clean
        model_number: $model_clean
        problem_summary: $problem_clean
        warranty_company: $warranty_clean
        claim_number: $claim_or_disp
        customer_type: "warranty"
        scheduling_status: "not_ready"
        current_status: "needs_scheduled"
        service_address: $service_addr_clean
        service_city: $service_city_clean
        service_state: $service_state_clean
        service_zip: $service_zip_clean
        parallel_mode: $parallel_mode_flag
        intake_source: $intake_src_clean
      }
    } as $new_job

    // ── Capture refs in plain vars BEFORE downstream writes ─────────
    // (avoids any chance of $new_job.id evaluation-order issues that
    // silently dropped the prior version's event_log + SMS)
    var $created_job_id {
      value = $new_job.id
    }

    var $created_customer_id {
      value = $cust_id_final
    }

    // ── Audit event_log ─────────────────────────────────────────────
    db.add event_log {
      data = {
        action: "parallel_job_created_from_email"
        metadata: {
          job_id: $created_job_id
          customer_id: $created_customer_id
          intake_source: $intake_src_clean
          warranty_company: $warranty_clean
          claim_number: $claim_or_disp
        }
      }
    } as $create_log

    // ── Danielle SMS alert ──────────────────────────────────────────
    var $dn_warranty {
      value = ($warranty_clean != "") ? $warranty_clean : "warranty"
    }

    var $dn_first {
      value = (($input.customer_first_name ?? "")|trim)
    }

    var $dn_last {
      value = (($input.customer_last_name ?? "")|trim)
    }

    var $dn_full_name {
      value = (($dn_first ~ " " ~ $dn_last)|trim)
    }

    var $dn_body {
      value = ("[ant] new " ~ $dn_warranty ~ " job in Needs Scheduled: " ~ $dn_full_name ~ ", " ~ $service_city_clean ~ ". tnapplianceexchange.net/needs-scheduled.html")
    }

    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      params = {
        to: "+16154850713"
        message: $dn_body
        context_tag: "parallel_intake_danielle_alert"
      }
      headers = ["Content-Type: application/json"]
      timeout = 30
    } as $danielle_alert
  }

  response = {
    success: true
    action: "created"
    job_id: $created_job_id
    customer_id: $created_customer_id
    intake_source: $intake_src_clean
  }

  guid = "create-job-from-email-v2"
}
