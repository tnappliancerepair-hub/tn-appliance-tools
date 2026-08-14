// Tech tap "Start Job" button - stamps job_started_at.
// Called from tech-ant-live.html action bar.
query tech_job_started verb=POST {
  api_group = "intake"

  input {
    int job_id
    int technician_id
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
  
    // Stamp the start timestamp + current_status mirror separately —
    // those aren't part of the state machine's scheduling_status concern.
    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        job_started_at: now
        current_status: "in_progress"
      }
    } as $job_updated

    // Delegate the scheduling_status write to the state machine.
    // actor=tech. If illegal (e.g., job not in 'scheduled' state) the
    // transition rejects + audits; we propagate the error.
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/transition_job_state"
      method = "POST"
      params = {
        job_id      : $input.job_id
        target_state: "in_progress"
        actor       : "tech"
        reason      : "tech_job_started"
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
        action  : "tech_job_started"
        metadata: {
        job_id       : $input.job_id
        technician_id: $input.technician_id
      }
      }
    } as $log
  
    // Phase 5.5B: emit JOB_STARTED colony signal (no agent listens today;
    // dispatcher returns no_agent_yet cleanly, hook in place for future).
    var $js_started_at_ms {
      value = now|to_ms
    }
  
    var $js_payload_obj {
      value = {
        job_id       : $input.job_id
        technician_id: $input.technician_id
        source       : "tech_button_start"
        started_at_ms: $js_started_at_ms
      }
    }
  
    var $js_payload_str {
      value = $js_payload_obj|json_encode
    }
  
    db.add colony_signals {
      data = {
        signal_type    : "JOB_STARTED"
        signal_strength: 60
        source_colony  : ""
        target_colonies: ""
        payload        : $js_payload_str
      }
    } as $js_signal
  
    // Emit PRE_JOB_BRIEFING in parallel — pre_job_briefing agent picks
    // this up, composes a smart SMS to the tech with model-specific
    // failure data + customer history + parts link. Async, fires once
    // per job (agent dedups via event_log).
    db.add colony_signals {
      data = {
        signal_type    : "PRE_JOB_BRIEFING"
        signal_strength: 70
        source_colony  : ""
        target_colonies: ""
        payload        : $js_payload_str
      }
    } as $briefing_signal
  
    // SMS Teddy with the update. Composed from customer + tech name.
    var $cust_id_val {
      value = ($job.customer_id ?? 0)
    }
  
    var $cust_name {
      value = "customer"
    }
  
    conditional {
      if ($cust_id_val > 0) {
        db.get customer {
          field_name = "id"
          field_value = $cust_id_val
        } as $cust
      
        var $cust_first {
          value = ($cust.first_name ?? "")|trim
        }
      
        var $cust_last {
          value = ($cust.last_name ?? "")|trim
        }
      
        var $cust_joined {
          value = ($cust_first ~ " " ~ $cust_last)|trim
        }
      
        conditional {
          if ($cust_joined != "") {
            var.update $cust_name {
              value = $cust_joined
            }
          }
        }
      }
    }
  
    db.get technicians {
      field_name = "id"
      field_value = $input.technician_id
    } as $tech
  
    var $tech_first {
      value = ($tech.first_name ?? "tech")|trim
    }
  
    var $appliance_str {
      value = ($job.appliance_type ?? "")|trim
    }
  
    // Owner "tech started job #X" SMS REMOVED (Teddy 2026-08-14): no value — the app
    // already shows when a tech has started a job. Job status is still flipped below;
    // only the owner notification text is eliminated.

    // Customer arrival SMS - "tech has arrived at your door".
    // Gated on $cust_id_val > 0 because $cust is only declared inside the
    // matching customer-load conditional above.
    conditional {
      if ($cust_id_val > 0) {
        var $cust_pref_raw {
          value = (($cust.preferred_name ?? "")|trim)
        }
      
        var $cust_first_clean {
          value = (($cust.first_name ?? "")|trim)
        }
      
        var $cust_display_name {
          value = ($cust_pref_raw != "") ? $cust_pref_raw : (($cust_first_clean != "") ? $cust_first_clean : "there")
        }
      
        var $tech_first_clean {
          value = (($tech.first_name ?? "")|trim)
        }
      
        var $tech_first_disp {
          value = ($tech_first_clean != "") ? ($tech_first_clean|to_lower) : "your tech"
        }
      
        var $appliance_clean {
          value = (($job.appliance_type ?? "")|trim)
        }
      
        var $appliance_disp_arr {
          value = ($appliance_clean != "") ? $appliance_clean : "appliance"
        }
      
        var $cust_phone_raw {
          value = (($cust.phone ?? "")|trim)
        }
      
        var $cust_phone_e164 {
          value = ($cust_phone_raw != "" && (($cust_phone_raw|starts_with:"+") == false)) ? ("+1" ~ $cust_phone_raw) : $cust_phone_raw
        }
      
        var $arrival_sms_body {
          value = "Hi " ~ $cust_display_name ~ " - " ~ $tech_first_disp ~ " has arrived and is ready to look at your " ~ $appliance_disp_arr ~ "!"
        }
      
        conditional {
          if ($cust_phone_e164 != "") {
            api.request {
              url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
              method = "POST"
              params = {to: $cust_phone_e164, message: $arrival_sms_body, context_tag: "arrival"}
              headers = ["Content-Type: application/json"]
              timeout = 30
            } as $cust_arrival_sms_resp
          
            db.add event_log {
              data = {
                action  : "tech_arrival_customer_sms"
                metadata: {
                job_id       : $input.job_id
                technician_id: $input.technician_id
                recipient    : $cust_phone_e164
              }
              }
            } as $arr_log
          }
        }
      }
    }
  
    // Phase 3 — Ant kickoff SMS to the TECH. After Start Job, text
    // them an opening so they know they can text findings back and
    // build the TDR conversationally over SMS. The tech_sms_assist
    // endpoint handles their replies (Claude classifies + extracts
    // TDR fields + replies with next question). When they reply SAVE,
    // the TDR is finalized.
    var $tech_phone_raw {
      value = (($tech.phone ?? "")|trim)
    }
  
    var $tech_phone_e164 {
      value = ($tech_phone_raw != "" && (($tech_phone_raw|starts_with:"+") == false)) ? ("+1" ~ $tech_phone_raw) : $tech_phone_raw
    }
  
    conditional {
      if ($tech_phone_e164 != "") {
        // Pull Teddy's pre-diagnosis if present
        db.query technician_decision_report {
          where = $db.technician_decision_report.job_id == $input.job_id && $db.technician_decision_report.technician_id == 1
          sort = {technician_decision_report.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $prediag_rows
      
        var $prediag {
          value = (($prediag_rows.items|first) ?? null)
        }
      
        var $prediag_line {
          value = ""
        }
      
        conditional {
          if ($prediag != null) {
            var $pd_diag {
              value = (($prediag.diagnosis ?? "")|trim)
            }
          
            var $pd_comp {
              value = (($prediag.failed_component ?? "")|trim)
            }
          
            var $pd_part {
              value = (($prediag.verified_part_number ?? "")|trim)
            }
          
            conditional {
              if ($pd_diag != "" || $pd_comp != "" || $pd_part != "") {
                var.update $prediag_line {
                  value = "\nTeddy's pre-diag: " ~ ($pd_diag != "" ? $pd_diag : "") ~ ($pd_comp != "" ? (" / failed=" ~ $pd_comp) : "") ~ ($pd_part != "" ? (" / part=" ~ $pd_part) : "")
                }
              }
            }
          }
        }
      
        // Re-resolve names locally (the customer-arrival block declared
        // similar vars inside its own conditional scope, but they're not
        // available out here).
        var $tech_kickoff_first {
          value = ($tech_first != "" && $tech_first != "tech") ? $tech_first : "there"
        }
      
        var $tech_appliance {
          value = ($appliance_str != "") ? $appliance_str : "appliance"
        }
      
        var $tech_cust {
          value = ($cust_name != "") ? $cust_name : "the customer"
        }
      
        var $kickoff_body {
          value = "[ant] hey " ~ $tech_kickoff_first ~ " — you're at " ~ $tech_cust ~ "'s for the " ~ $tech_appliance ~ "." ~ $prediag_line ~ "\n\nText me findings as you check and I'll fill the TDR. When done text SAVE."
        }
      
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {to: $tech_phone_e164, message: $kickoff_body}
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $tech_kickoff_resp
      
        db.add event_log {
          data = {
            action  : "tech_sms_kickoff_sent"
            metadata: {
            job_id         : $input.job_id
            technician_id  : $input.technician_id
            tech_phone     : $tech_phone_e164
            prediag_present: ($prediag != null)
          }
          }
        } as $kickoff_log
      }
    }
  }

  response = {success: true}
  guid = "F6uuTqoOb83MLbbowA_B4Zih7KA"
}