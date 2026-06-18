//  Creates a Technician Decision Report, optionally creates a child
//  tdr_failure row when failure_description is provided, and routes side
//  effects (Danielle SMS + HCP note) by mode.
// 
//  Phase 1g 2026-05-06: added pre-diagnosis mode for Teddy cockpit.
//    mode = "pre_diagnosis": clean cockpit-formatted HCP note + flips
//      job.pre_diagnosis_complete = true. Skips the completion-style
//      Danielle SMS and big summary HCP note (those describe a finished
//      job, not a diagnosis).
//    mode unset / any other value: existing completion behavior unchanged
//      (Danielle SMS + summary HCP note posted) for back-compat with
//      Tech Ant and other completion-flow callers.
// 
//  Phase 1f gap close: tdr_failure rows are now created here when the
//  caller passes failure_description + cost cents, instead of needing
//  manual Metadata API insertion.
query create_tdr verb=POST {
  api_group = "intake"

  input {
    int job_id
    int technician_id?
    text technician_first_name? filters=trim
    text technician_last_name? filters=trim
    text confidence_level? filters=trim
    text verified_part_number? filters=trim
    text part_number_confidence? filters=trim
    text estimated_repair_cost_range? filters=trim
    text diy_feasibility_rating? filters=trim
    text final_recommendation? filters=trim
    text technician_notes? filters=trim
    text problem_summary? filters=trim
    text status? filters=trim
    text report_url? filters=trim
    text repair_completed?
    text repair_not_completed_reason?
    json parts_used?
    json parts_not_used?
    decimal labor_time_hours?
    bool second_visit_needed?
    json part_name_only_flags?
    text failure_cause?
    text failure_cause_notes?
    text diagnostic_test_performed?
    text? diagnosis?
    text failed_component?
    text customer_facing_diagnosis?
    text mode?
    text failure_description? filters=trim
    text oem_part_number? filters=trim
    text amazon_part_number? filters=trim
    int oem_part_our_cost_cents?
    int amazon_part_our_cost_cents?
    int labor_customer_cost_cents?
  }

  stack {
    db.add technician_decision_report {
      data = {
        job_id                     : $input.job_id
        report_date                : now
        technician_id              : $input.technician_id
        technician_first_name      : $input.technician_first_name
        technician_last_name       : $input.technician_last_name
        confidence_level           : $input.confidence_level
        verified_part_number       : $input.verified_part_number
        part_number_confidence     : $input.part_number_confidence
        estimated_repair_cost_range: $input.estimated_repair_cost_range
        diy_feasibility_rating     : $input.diy_feasibility_rating
        final_recommendation       : $input.final_recommendation
        technician_notes           : $input.technician_notes
        problem_summary            : $input.problem_summary
        status                     : $input.status
        report_url                 : $input.report_url
        repair_completed           : $input.repair_completed
        repair_not_completed_reason: $input.repair_not_completed_reason
        parts_used                 : $input.parts_used
        parts_not_used             : $input.parts_not_used
        labor_time_hours           : $input.labor_time_hours
        second_visit_needed        : $input.second_visit_needed
        part_name_only_flags       : $input.part_name_only_flags
        failure_cause              : $input.failure_cause
        failure_cause_notes        : $input.failure_cause_notes
        diagnostic_test_performed  : $input.diagnostic_test_performed
        diagnosis                  : $input.diagnosis
        failed_component           : $input.failed_component
        customer_facing_diagnosis  : $input.customer_facing_diagnosis
      }
    } as $new_tdr
  
    db.get jobs {
      field_name = "id"
      field_value = $new_tdr.job_id
    } as $job
  
    db.get customer {
      field_name = "id"
      field_value = $job.customer_id
    } as $customer
  
    var $sms_response {
      value = null
    }
  
    var $hcp_note_response {
      value = null
    }
  
    var $tdr_failure_id {
      value = null
    }
  
    conditional {
      if ($input.failure_description != null && $input.failure_description != "") {
        db.add tdr_failure {
          data = {
            tdr_id                        : $new_tdr.id
            failure_description           : $input.failure_description
            tenant_reported               : false
            recommended_oem_part_number   : ($input.oem_part_number ?? null)
            oem_part_our_cost_cents       : ($input.oem_part_our_cost_cents ?? 0)
            recommended_amazon_part_number: ($input.amazon_part_number ?? null)
            amazon_part_our_cost_cents    : ($input.amazon_part_our_cost_cents ?? 0)
            labor_customer_cost_cents     : ($input.labor_customer_cost_cents ?? 0)
            selected_option               : "pending"
          }
        } as $new_failure
      
        var.update $tdr_failure_id {
          value = $new_failure.id
        }
      }
    }
  
    conditional {
      if ($input.failure_description == null || $input.failure_description == "") {
        db.add event_log {
          data = {
            action  : "tdr_failure_skipped"
            metadata: {
            tdr_id     : $new_tdr.id
            job_id     : $new_tdr.job_id
            reason     : "missing_failure_description"
            caller_mode: ($input.mode ?? "completion")
          }
          }
        } as $skip_log
      }
    }
  
    var $mode {
      value = ($input.mode ?? "completion")
    }
  
    // ===== PRE-DIAGNOSIS PATH (Phase 1g cockpit) =====
    conditional {
      if ($mode == "pre_diagnosis") {
        var $oem_pn_disp {
          value = ((($input.oem_part_number ?? "")|trim) == "") ? "-" : $input.oem_part_number
        }
      
        var $amz_pn_disp {
          value = ((($input.amazon_part_number ?? "")|trim) == "") ? "-" : $input.amazon_part_number
        }
      
        var $oem_dollars_disp {
          value = (($input.oem_part_our_cost_cents ?? 0) > 0) ? ("$" ~ (($input.oem_part_our_cost_cents / 100)|to_text)) : "-"
        }
      
        var $amz_dollars_disp {
          value = (($input.amazon_part_our_cost_cents ?? 0) > 0) ? ("$" ~ (($input.amazon_part_our_cost_cents / 100)|to_text)) : "-"
        }
      
        var $labor_dollars_disp {
          value = (($input.labor_customer_cost_cents ?? 0) > 0) ? ("$" ~ (($input.labor_customer_cost_cents / 100)|to_text)) : "-"
        }
      
        var $notes_block {
          value = ((($input.technician_notes ?? "")|trim) == "") ? "" : ("\n\n" ~ $input.technician_notes)
        }
      
        var $failure_disp {
          value = ((($input.failure_description ?? "")|trim) == "") ? ($input.diagnosis ?? "-") : $input.failure_description
        }
      
        var $prediag_note {
          value = "PRE-DIAGNOSIS by Teddy\n\nFailure: " ~ $failure_disp ~ "\n\nOEM Part: " ~ $oem_pn_disp ~ "  Our cost: " ~ $oem_dollars_disp ~ "\nAmazon equivalent: " ~ $amz_pn_disp ~ "  Our cost: " ~ $amz_dollars_disp ~ "\nLabor estimate: " ~ $labor_dollars_disp ~ " (customer-facing)" ~ $notes_block
        }
      
        // HCP write kill-switch - parallel ANT system rule: NO HCP WRITES.
        // When env.HCP_PUSH_DISABLED=true (default for parallel mode) the
        // HCP-side note push is skipped entirely. Local TDR row still saves.
        var $hcp_disabled_tdr {
          value = ((($env.HCP_PUSH_DISABLED ?? "")|lower) == "true")
        }
      
        conditional {
          if (!$hcp_disabled_tdr && $job.housecall_pro_job_id != null && $job.housecall_pro_job_id != "") {
            api.request {
              url = $env.HCP_BASE_URL ~ "/jobs/" ~ $job.housecall_pro_job_id ~ "/notes"
              method = "POST"
              params = {content: $prediag_note}
              headers = [
                "Authorization: Token " ~ $env.HCP_API_KEY
                "Content-Type: application/json"
                "Accept: application/json"
              ]
            
              timeout = 30
            } as $prediag_hcp_resp
          
            var.update $hcp_note_response {
              value = $prediag_hcp_resp
            }
          }
        }
      
        db.edit jobs {
          field_name = "id"
          field_value = $job.id
          data = {pre_diagnosis_complete: true}
        } as $job_prediag_updated
      
        // Danielle notify: fires after pre_diagnosis_complete is set,
        // regardless of HCP sync outcome.
        var $dn_cust_first {
          value = (($customer.first_name ?? "")|trim)
        }
      
        var $dn_cust_last {
          value = (($customer.last_name ?? "")|trim)
        }
      
        var $dn_cust_name {
          value = $dn_cust_first ~ " " ~ $dn_cust_last
        }
      
        var $dn_brand {
          value = (($job.brand ?? "")|trim)
        }
      
        var $dn_appl {
          value = (($job.appliance_type ?? "")|trim)
        }
      
        var $dn_diag_raw {
          value = (($input.customer_facing_diagnosis ?? "")|trim)
        }
      
        conditional {
          if ($dn_diag_raw == "") {
            var.update $dn_diag_raw {
              value = (($input.diagnosis ?? "")|trim)
            }
          }
        }
      
        conditional {
          if ($dn_diag_raw == "") {
            var.update $dn_diag_raw {
              value = (($input.failure_description ?? "")|trim)
            }
          }
        }
      
        var $dn_diag {
          value = $dn_diag_raw|substr:0:100
        }
      
        var $dn_oem_part {
          value = (($input.oem_part_number ?? "")|trim)
        }
      
        var $dn_amz_part {
          value = (($input.amazon_part_number ?? "")|trim)
        }
      
        var $dn_part {
          value = ($dn_oem_part != "") ? $dn_oem_part : $dn_amz_part
        }
      
        var $dn_claim {
          value = (($job.claim_number ?? "")|trim)
        }
      
        var $dn_warranty {
          value = (($job.warranty_company ?? "")|trim)
        }
      
        var $dn_hcp_link {
          value = ""
        }
      
        conditional {
          if ($job.housecall_pro_job_id != null && $job.housecall_pro_job_id != "") {
            var.update $dn_hcp_link {
              value = "\n\nhttps://pro.housecallpro.com/app/jobs/" ~ $job.housecall_pro_job_id
            }
          }
        }
      
        var $dn_sms_body {
          value = "TDR submitted - Job #" ~ ($job.id|to_text) ~ " - " ~ $dn_cust_name ~ "\n" ~ $dn_brand ~ " " ~ $dn_appl ~ "\nDiagnosis: " ~ $dn_diag ~ "\nPart: " ~ $dn_part ~ "\nClaim #: " ~ $dn_claim ~ "\nWarranty: " ~ $dn_warranty ~ $dn_hcp_link
        }
      
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {to: "+16154850713", message: $dn_sms_body}
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $danielle_prediag_sms
      
        db.add event_log {
          data = {
            action  : "danielle_tdr_submitted_sms"
            metadata: {
            job_id      : $job.id
            tdr_id      : $new_tdr.id
            customer    : $dn_cust_name
            has_hcp_link: ($job.housecall_pro_job_id != null && $job.housecall_pro_job_id != "")
            sms_response: ($danielle_prediag_sms.response.result ?? {})
          }
          }
        } as $danielle_prediag_log
      }
    }
  
    // ===== COMPLETION PATH (legacy default) =====
    conditional {
      if ($mode != "pre_diagnosis") {
        var $parts_used_list {
          value = `(($input.parts_used|is_array) && (($input.parts_used|count) > 0)) ? (($input.parts_used|map:(($$.part_number ?? "N/A") ~ " - " ~ ($$.description ?? "No description") ~ " (" ~ ($$.quantity|to_text) ~ ")"))|join:"\n") : "None"`
        }
      
        var $parts_not_used_list {
          value = `(($input.parts_not_used|is_array) && (($input.parts_not_used|count) > 0)) ? (($input.parts_not_used|map:(($$.part_number ?? "N/A") ~ " - " ~ ($$.description ?? "No description") ~ " (" ~ ($$.quantity|to_text) ~ ")"))|join:"\n") : "None"`
        }
      
        var $office_lookup_list {
          value = (($input.part_name_only_flags|is_array) && (($input.part_name_only_flags|count) > 0)) ? ($input.part_name_only_flags|join:"\n") : "None"
        }
      
        var $customer_name {
          value = ($customer.first_name ?? "") ~ " " ~ ($customer.last_name ?? "")
        }
      
        var $sf_job_id {
          value = $job.id|to_text
        }
      
        var $sf_brand {
          value = ($job.brand ?? "Unknown")
        }
      
        var $sf_appl {
          value = ($job.appliance_type ?? "Unknown")
        }
      
        var $sf_model {
          value = ($job.model_number ?? "Not provided")
        }
      
        var $sf_diag {
          value = ($input.diagnosis ?? "Not provided")
        }
      
        var $sf_repair {
          value = ($input.repair_completed ?? "N/A")
        }
      
        var $sf_labor {
          value = $input.labor_time_hours|to_text
        }
      
        var $sf_second_visit {
          value = ($input.second_visit_needed ? "Yes" : "No")
        }
      
        var $sf_recommendation {
          value = ($input.final_recommendation ?? "N/A")
        }
      
        var $sf_tech_first {
          value = ($input.technician_first_name ?? "Tech")
        }
      
        var $sf_tech_last {
          value = ($input.technician_last_name ?? "")
        }

        var $sf_diag_trim {
          value = (($input.diagnosis ?? "")|trim)
        }

        var $sf_repair_trim {
          value = (($input.repair_completed ?? "")|trim)
        }

        // Empty-report guard: if the tech submitted with no real diagnosis AND no
        // repair detail, this is NOT a finished report. Label it "REPORT NEEDED"
        // so Danielle is never told an empty TDR is complete.
        var $tdr_is_substantive {
          value = ($sf_diag_trim != "" || $sf_repair_trim != "")
        }

        var $tdr_header_prefix {
          value = ($tdr_is_substantive ? "🔧 TDR COMPLETE" : "📋 REPORT NEEDED (tech submitted an empty report)")
        }

        var $summary_template {
          value = """
            %s - Job #%s
            Customer: %s
            Appliance: %s %s
            Model: %s
            
            🔍 Diagnosis: %s
            
            ✅ Repair completed: %s
            ⏱ Labor: %s hrs
            🔁 Second visit: %s
            
            PARTS USED:
            %s
            
            PARTS TO RETURN:
            %s
            
            ⚠️ OFFICE LOOKUP NEEDED:
            %s
            
            Recommendation: %s
            Tech: %s %s
            """
        }
      
        var $summary_text {
          value = $summary_template
            |sprintf:$tdr_header_prefix:$sf_job_id:$customer_name:$sf_brand:$sf_appl:$sf_model:$sf_diag:$sf_repair:$sf_labor:$sf_second_visit:$parts_used_list:$parts_not_used_list:$office_lookup_list:$sf_recommendation:$sf_tech_first:$sf_tech_last
        }
      
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {to: "+16154850713", message: $summary_text}
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $sms_resp_completion
      
        var.update $sms_response {
          value = $sms_resp_completion
        }
      
        // HCP write kill-switch (completion path mirror of pre-diag block above)
        var $hcp_disabled_compl {
          value = ((($env.HCP_PUSH_DISABLED ?? "")|lower) == "true")
        }
      
        conditional {
          if (!$hcp_disabled_compl && $job.housecall_pro_job_id != null && $job.housecall_pro_job_id != "") {
            api.request {
              url = $env.HCP_BASE_URL ~ "/jobs/" ~ $job.housecall_pro_job_id ~ "/notes"
              method = "POST"
              params = {content: $summary_text}
              headers = [
                "Authorization: Token " ~ $env.HCP_API_KEY
                "Content-Type: application/json"
                "Accept: application/json"
              ]
            
              timeout = 30
            } as $hcp_resp_completion
          
            var.update $hcp_note_response {
              value = $hcp_resp_completion
            }
          }
        }
      }
    }
  
    // Emit TDR_SUBMITTED for the parts-pricing router (tdr_submitted.js).
    // The router fans out PARTS_LOOKUP_<SUPPLIER>_PRICING signals to the
    // dormant Marcone/RepairClinic/PartSelect agents so Teddy gets real
    // parts pricing back instead of relying on the Sears Parts Direct
    // stopgap. Independent emit so a failure here doesn't break create_tdr.
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $tdr_job
  
    var $ts_payload_obj {
      value = {
        tdr_id              : $new_tdr.id
        job_id              : $input.job_id
        brand               : ($tdr_job.brand ?? "")
        appliance_type      : ($tdr_job.appliance_type ?? "")
        model_number        : ($tdr_job.model_number ?? "")
        failed_component    : ($input.failed_component ?? "")
        verified_part_number: ($input.verified_part_number ?? "")
        technician_id       : ($input.technician_id ?? null)
        repair_completed    : ($input.repair_completed ?? "")
        repair_not_completed_reason: ($input.repair_not_completed_reason ?? "")
        second_visit_needed : ($input.second_visit_needed ?? false)
        oem_part_number     : ($input.oem_part_number ?? "")
        amazon_part_number  : ($input.amazon_part_number ?? "")
        failure_cause       : ($input.failure_cause ?? "")
        diagnosis           : ($input.diagnosis ?? "")
        scheduling_status   : ($tdr_job.scheduling_status ?? "")
      }
    }
  
    var $ts_payload_str {
      value = $ts_payload_obj|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "TDR_SUBMITTED"
        signal_strength: 60
        source_colony  : ""
        target_colonies: ""
        payload        : $ts_payload_str
      }
    } as $ts_signal
  
    db.add event_log {
      data = {
        action  : "tdr_submitted_signal_emitted"
        metadata: {
        tdr_id   : $new_tdr.id
        job_id   : $input.job_id
        signal_id: $ts_signal.id
      }
      }
    } as $ts_log
  }

  response = {
    tdr           : $new_tdr
    tdr_failure_id: $tdr_failure_id
    hcp_sync      : $hcp_note_response
    sms_response  : $sms_response
    mode          : ($input.mode ?? "completion")
  }

  guid = "qAQK3BtYtScefCVFBke4MGut26Q"
}