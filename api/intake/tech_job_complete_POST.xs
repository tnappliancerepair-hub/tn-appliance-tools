// Tech tap "Complete" dropdown - stamps job_completed_at, calculates time on site,
// maps completion_type to scheduling_status. Idempotent: refuses if already completed.
// On completion (except no_repair), writes a tech_earnings stub row to be backfilled
// when payment is collected (stripe webhook for self_pay, remittance match for warranty).
// Called from tech-ant-live.html action bar.
query tech_job_complete verb=POST {
  api_group = "intake"

  input {
    int job_id
    int technician_id
    text completion_type
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    conditional {
      if ($job == null) {
        return {
          value = {success: false, error: "job not found"}
        }
      }
    }
  
    conditional {
      if ($job.technician_id != $input.technician_id) {
        return {
          value = {success: false, error: "tech does not own this job"}
        }
      }
    }
  
    // Idempotency gate: refuse if already completed.
    conditional {
      if ($job.job_completed_at != null) {
        return {
          value = {success: false, error: "job already completed"}
        }
      }
    }
  
    // Completion-photo gate: warranty + repair_complete must have ≥1
    // attachment. Insurance + audit safeguard.
    conditional {
      if ($input.completion_type == "repair_complete" && ($job.customer_type ? "") == "warranty") {
        db.query job_attachments {
          where = $db.job_attachments.job_id == $input.job_id && $db.job_attachments.upload_complete_at != null
          return = {type: "count"}
        } as $att_count
      
        conditional {
          if (($att_count ? 0) == 0) {
            db.add event_log {
              data = {
                action  : "tech_job_complete_blocked_no_photos"
                metadata: {
                job_id       : $input.job_id
                technician_id: $input.technician_id
                customer_type: ($job.customer_type ?? "")
              }
              }
            } as $block_log
          
            return {
              value = {
                success      : false
                error        : "no_completion_photos"
                error_message: "Need at least 1 photo before completing this warranty job."
              }
            }
          }
        }
      }
    }
  
    // TDR completeness gate. ONLY applies when completion_type=repair_complete
    // AND customer_type=warranty — warranty submission requires a full TDR
    // (5 fields: diagnosis, failure_cause, failed_component, repair_completed,
    // labor_time_hours > 0). Self-pay repair_complete passes through; the
    // transition states (parts_needed, warranty_auth_needed, no_repair) also
    // pass through because they don't trigger downstream warranty submission.
    conditional {
      if ($input.completion_type == "repair_complete" && ($job.customer_type ? "") == "warranty") {
        db.query technician_decision_report {
          where = $db.technician_decision_report.job_id == $input.job_id && $db.technician_decision_report.technician_id == $input.technician_id
          sort = {technician_decision_report.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $tdr_gate_rows
      
        var $tdr_gate {
          value = (($tdr_gate_rows.items|first) ?? null)
        }
      
        var $missing_fields {
          value = []
        }
      
        conditional {
          if ($tdr_gate == null) {
            var.update $missing_fields {
              value = [
                "diagnosis"
                "failure_cause"
                "failed_component"
                "repair_completed"
                "labor_time_hours"
              ]
            }
          }
        
          else {
            var $g_diag {
              value = ($tdr_gate.diagnosis ?? "")|trim
            }
          
            var $g_fail {
              value = ($tdr_gate.failure_cause ?? "")|trim
            }
          
            var $g_comp {
              value = ($tdr_gate.failed_component ?? "")|trim
            }
          
            var $g_repair {
              value = ($tdr_gate.repair_completed ?? "")|trim
            }
          
            var $g_labor {
              value = ($tdr_gate.labor_time_hours ?? 0)
            }
          
            conditional {
              if ($g_diag == "") {
                var.update $missing_fields {
                  value = $missing_fields|push:"diagnosis"
                }
              }
            }
          
            conditional {
              if ($g_fail == "") {
                var.update $missing_fields {
                  value = $missing_fields|push:"failure_cause"
                }
              }
            }
          
            conditional {
              if ($g_comp == "") {
                var.update $missing_fields {
                  value = $missing_fields|push:"failed_component"
                }
              }
            }
          
            conditional {
              if ($g_repair == "") {
                var.update $missing_fields {
                  value = $missing_fields|push:"repair_completed"
                }
              }
            }
          
            conditional {
              if ($g_labor <= 0) {
                var.update $missing_fields {
                  value = $missing_fields|push:"labor_time_hours"
                }
              }
            }
          }
        }
      
        conditional {
          if (($missing_fields|count) > 0) {
            db.add event_log {
              data = {
                action  : "tech_job_complete_blocked_tdr_incomplete"
                metadata: {
                job_id        : $input.job_id
                technician_id : $input.technician_id
                missing_fields: $missing_fields
                customer_type : ($job.customer_type ?? "")
              }
              }
            } as $block_log
          
            return {
              value = {
                success       : false
                error         : "tdr_incomplete"
                error_message : "Complete the TDR before marking the job complete."
                missing_fields: $missing_fields
              }
            }
          }
        }
      }
    }
  
    // Time on site (null-safe: skip if job_started_at is null).
    var $now_ts {
      value = now
    }
  
    var $time_on_site_minutes {
      value = null
    }
  
    conditional {
      if ($job.job_started_at != null) {
        var.update $time_on_site_minutes {
          value = ((($now_ts|to_ms) - ($job.job_started_at|to_ms)) / 60000)|to_int
        }
      }
    }
  
    // Map completion_type to scheduling_status. The jobs.scheduling_status
    // column is an enum - only the listed values are accepted by Xano. Mapping
    // uses the closest semantic enum match; future enum additions can refine.
    //   repair_complete       -> completed         (job is done, customer satisfied)
    //   parts_needed          -> awaiting_parts    (waiting on parts order)
    //   warranty_auth_needed  -> held              (waiting on external auth)
    //   no_repair             -> no_fix_possible   (tech determined unrepairable)
    //   other                 -> completed         (default to done if ambiguous)
    var $new_status {
      value = "completed"
    }
  
    conditional {
      if ($input.completion_type == "repair_complete") {
        var.update $new_status {
          value = "completed"
        }
      }
    
      elseif ($input.completion_type == "parts_needed") {
        var.update $new_status {
          value = "awaiting_parts"
        }
      }
    
      elseif ($input.completion_type == "warranty_auth_needed") {
        var.update $new_status {
          value = "held"
        }
      }
    
      elseif ($input.completion_type == "no_repair") {
        var.update $new_status {
          value = "no_fix_possible"
        }
      }
    
      else {
        var.update $new_status {
          value = "completed"
        }
      }
    }
  
    // Stamp the completion timestamp + current_status mirror separately.
    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        job_completed_at    : $now_ts
        time_on_site_minutes: $time_on_site_minutes
        current_status      : $new_status
      }
    } as $job_updated

    // Delegate the scheduling_status write to the state machine.
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/transition_job_state"
      method = "POST"
      params = {
        job_id      : $input.job_id
        target_state: $new_status
        actor       : "tech"
        reason      : ("tech_job_complete: " ~ ($input.completion_type ?? ""))
      }
      headers = ["Content-Type: application/json"]
      timeout = 30
    } as $transition_resp

    var $transition_ok {
      value = (($transition_resp.response.result.success ?? false) == true)
    }

    conditional {
      if ($transition_ok == false) {
        return {
          value = {
            success: false
            error  : (($transition_resp.response.result.error ?? "transition_failed")|to_text)
          }
        }
      }
    }
  
    db.add event_log {
      data = {
        action  : "tech_job_complete"
        metadata: {
        job_id               : $input.job_id
        technician_id        : $input.technician_id
        completion_type      : $input.completion_type
        time_on_site_minutes : $time_on_site_minutes
        new_scheduling_status: $new_status
      }
      }
    } as $log
  
    // Tech earnings stub row (Option B from design doc reconciliation).
    // labor_amount + commission_earned start at 0 and are backfilled when
    // payment is reconciled (stripe webhook for self_pay, remittance match
    // for warranty). Skipped for no_repair - no work done, no earnings.
    // $earnings_id declared at stack scope so the response can return it
    // (null when no_repair, the new row id otherwise).
    var $earnings_id {
      value = null
    }
  
    conditional {
      if ($input.completion_type != "no_repair") {
        db.get technicians {
          field_name = "id"
          field_value = $input.technician_id
        } as $tech
      
        db.add tech_earnings {
          data = {
            tech_id          : $input.technician_id
            job_id           : $input.job_id
            job_type         : ($job.customer_type ?? "")
            labor_amount     : 0
            commission_rate  : ($tech.commission_rate ?? 0)
            commission_earned: 0
            addon_commission : 0
            parts_markup     : 0
            total_earned     : 0
            status           : "pending_payment"
            earned_at        : $now_ts
            paid_at          : null
            payout_batch_date: null
          }
        } as $earnings
      
        var.update $earnings_id {
          value = $earnings.id
        }
      
        db.add event_log {
          data = {
            action  : "tech_earnings_stub_created"
            metadata: {
            tech_id        : $input.technician_id
            job_id         : $input.job_id
            earnings_id    : $earnings.id
            commission_rate: ($tech.commission_rate ?? 0)
          }
          }
        } as $earnings_log
      }
    }
  
    // Phase 5.5B: emit JOB_COMPLETED colony signal so the Mac Mini loop
    // (warranty_submission agent + future hooks) reacts to tech-side
    // completions, not only HCP-driven ones. Always emit - the agent
    // self-filters by warranty_company / customer_type.
    var $jc_warranty_company {
      value = ($job.warranty_company ?? "")
    }
  
    var $jc_claim_number {
      value = ($job.claim_number ?? "")
    }
  
    var $jc_customer_type {
      value = ($job.customer_type ?? "")
    }
  
    var $jc_completed_at_ms {
      value = $now_ts|to_ms
    }
  
    var $jc_payload_obj {
      value = {
        job_id          : $input.job_id
        source          : "tech_button_complete"
        completion_type : $input.completion_type
        warranty_company: $jc_warranty_company
        claim_number    : $jc_claim_number
        customer_type   : $jc_customer_type
        completed_at_ms : $jc_completed_at_ms
      }
    }
  
    var $jc_payload_str {
      value = $jc_payload_obj|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "JOB_COMPLETED"
        signal_strength: 60
        source_colony  : ""
        target_colonies: ""
        payload        : $jc_payload_str
      }
    } as $jc_signal
  
    // SMS Teddy with the completion update. Customer + appliance for context.
    var $cust_id_val_c {
      value = ($job.customer_id ?? 0)
    }
  
    var $cust_name_c {
      value = "customer"
    }
  
    conditional {
      if ($cust_id_val_c > 0) {
        db.get customer {
          field_name = "id"
          field_value = $cust_id_val_c
        } as $cust_c
      
        var $cust_first_c {
          value = ($cust_c.first_name ?? "")|trim
        }
      
        var $cust_last_c {
          value = ($cust_c.last_name ?? "")|trim
        }
      
        var $cust_joined_c {
          value = ($cust_first_c ~ " " ~ $cust_last_c)|trim
        }
      
        conditional {
          if ($cust_joined_c != "") {
            var.update $cust_name_c {
              value = $cust_joined_c
            }
          }
        }
      }
    }
  
    db.get technicians {
      field_name = "id"
      field_value = $input.technician_id
    } as $tech_c
  
    var $tech_first_c {
      value = ($tech_c.first_name ?? "tech")|trim
    }
  
    var $appliance_str_c {
      value = ($job.appliance_type ?? "")|trim
    }
  
    var $time_on_site_str {
      value = ($time_on_site_minutes != null) ? (($time_on_site_minutes|to_text) ~ "min") : "—"
    }
  
    var $sms_body_c {
      value = "[ant] " ~ $tech_first_c ~ " completed job #" ~ ($input.job_id|to_text) ~ " (" ~ ($input.completion_type ?? "") ~ ") - " ~ $time_on_site_str ~ " - " ~ $cust_name_c ~ ", " ~ $appliance_str_c
    }
  
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      params = {
        to     : ($env.OWNER_PHONE_NUMBER ?? "")
        message: $sms_body_c
      }
    
      headers = ["Content-Type: application/json"]
      timeout = 30
    } as $teddy_sms_c_resp
  }

  response = {
    success             : true
    time_on_site_minutes: $time_on_site_minutes
    earnings_id         : $earnings_id
  }

  guid = "5IhAClwNjzetmRinKql3GyMb53Q"
}