// Phase 1c. Soft-block completion gate. Resolves a tech_assist_session by
// session_id OR (job_id, technician_id). If required_fields_remaining is empty,
// flips status to "complete" and returns complete:true. Otherwise flips status
// to "awaiting_completion" and returns complete:false with the missing list.
// Called by hcp_job_webhook on work_status=completed and by the escalation cron.
// Does NOT block HCP completion - the gate is observational, not enforcing.
// See docs/ant-tech-assist-design-v1.md.
query validate_tdr_completeness verb=POST {
  api_group = "intake"

  input {
    int? session_id?
    int? job_id?
    int? technician_id?
  }

  stack {
    // ── 1. Resolve session ──
    var $session {
      value = null
    }
  
    conditional {
      if ($input.session_id != null && $input.session_id > 0) {
        db.get tech_assist_session {
          field_name = "id"
          field_value = $input.session_id
        } as $session
      }
    
      else {
        conditional {
          if ($input.job_id != null && $input.job_id > 0 && $input.technician_id != null && $input.technician_id > 0) {
            db.query tech_assist_session {
              where = $db.tech_assist_session.job_id == $input.job_id && $db.tech_assist_session.technician_id == $input.technician_id && ($db.tech_assist_session.status == "active" || $db.tech_assist_session.status == "awaiting_completion")
              sort = {tech_assist_session.created_at: "desc"}
              return = {type: "single"}
            } as $session
          }
        }
      }
    }
  
    conditional {
      if ($session == null) {
        return {
          value = {
            success: false
            error  : "no session found - provide session_id or (job_id, technician_id)"
          }
        }
      }
    }
  
    // ── 2. Determine completeness ──
    var $remaining {
      value = $session.required_fields_remaining ?? []
    }
  
    var $remaining_count {
      value = $remaining|count
    }
  
    var $is_complete {
      value = ($remaining_count == 0)
    }
  
    // ── 3. Update session.status accordingly ──
    var $new_status {
      value = ($is_complete == true) ? "complete" : "awaiting_completion"
    }
  
    db.edit tech_assist_session {
      field_name = "id"
      field_value = $session.id
      data = {status: $new_status, updated_at: now}
    } as $updated_session
  
    // ── 4. Audit ──
    db.add event_log {
      data = {
        action  : "tdr_completeness_checked"
        metadata: {
        session_id    : $session.id
        job_id        : $session.job_id
        technician_id : $session.technician_id
        complete      : $is_complete
        missing_count : $remaining_count
        missing_fields: $remaining
        new_status    : $new_status
      }
      }
    } as $check_log
  
    // Build 4 (Phase 8b): when validate flips status to "complete", auto-create
    // a TDR stub and notify Danielle. Transition-guarded (only fires when status
    // was NOT already "complete") so repeat validate calls don't create duplicate
    // TDR rows. $session holds the pre-flip status because the db.edit at line 67
    // captures the new state in $updated_session, not $session.
    conditional {
      if ($new_status == "complete" && $session.status != "complete") {
        // Load tech (validate_tdr_completeness doesn't load it on other paths).
        db.get technicians {
          field_name = "id"
          field_value = $session.technician_id
        } as $tech
      
        // Load job for TDR creation + Danielle SMS body.
        db.get jobs {
          field_name = "id"
          field_value = $session.job_id
        } as $tdr_job
      
        // Create minimal TDR stub so Danielle has a record to work from.
        db.add technician_decision_report {
          data = {
            job_id                   : $session.job_id
            technician_id            : $session.technician_id
            mode                     : "completion"
            status                   : "submitted"
            diagnosis                : ($session.captured_data.diagnosis ?? "")
            customer_facing_diagnosis: ($session.captured_data.diagnosis ?? "")
            verified_part_number     : ($session.captured_data.part_number ?? "")
            technician_notes         : ($session.captured_data.tech_notes ?? "")
            report_date              : now
          }
        } as $auto_tdr
      
        // Notify Danielle via send_sms wrapper (routes through Telnyx per
        // internal-recipient detection; Danielle's number gets TELNYX_FROM_TECH).
        var $tdr_tech_first {
          value = (($tech.first_name ?? "")|trim)
        }
      
        var $tdr_job_appl {
          value = (($tdr_job.appliance_type ?? "")|trim)
        }
      
        var $tdr_brand {
          value = (($tdr_job.brand ?? "")|trim)
        }
      
        var $tdr_part {
          value = (($session.captured_data.part_number ?? "")|trim)
        }
      
        var $tdr_diag {
          value = (($session.captured_data.diagnosis ?? "")|trim|substr:0:100)
        }
      
        var $tdr_notify_body {
          value = "TDR auto-submitted - Job #" ~ ($session.job_id|to_text) ~ " - " ~ $tdr_tech_first ~ "\n" ~ $tdr_brand ~ " " ~ $tdr_job_appl ~ "\nPart: " ~ $tdr_part ~ "\nDiagnosis: " ~ $tdr_diag ~ "\n\nTDR #" ~ ($auto_tdr.id|to_text) ~ " created."
        }
      
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {to: "+16154850713", message: $tdr_notify_body}
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $tdr_notify_sms
      
        // ── Customer SMS: notify diagnosis complete ──
        // Load customer for phone + preferred name. Gate on phone present.
        // External recipient: send_sms wrapper routes through Twilio.
        // Uses $auto_tdr.customer_facing_diagnosis (sanitized by Teddy/tech),
        // NOT raw $session.captured_data.diagnosis which may be tech-shorthand.
        var $cust {
          value = null
        }
      
        conditional {
          if ($tdr_job.customer_id != null && $tdr_job.customer_id > 0) {
            db.get customer {
              field_name = "id"
              field_value = $tdr_job.customer_id
            } as $cust
          }
        }
      
        var $cust_phone_raw {
          value = ($cust.phone ?? "")|trim
        }
      
        var $cust_phone_e164 {
          value = ($cust_phone_raw != "" && (($cust_phone_raw|starts_with:"+") == false)) ? ("+1" ~ $cust_phone_raw) : $cust_phone_raw
        }
      
        conditional {
          if ($cust_phone_e164 != "") {
            // Preferred-name fallback: preferred_name -> first_name -> "there".
            var $cust_pref_raw {
              value = ($cust.preferred_name ?? "")|trim
            }
          
            var $cust_first_raw {
              value = ($cust.first_name ?? "")|trim
            }
          
            var $cust_display_name {
              value = ($cust_pref_raw != "") ? $cust_pref_raw : (($cust_first_raw != "") ? $cust_first_raw : "there")
            }
          
            // Tech first lowercase, fallback to "your tech".
            var $cust_tech_first_lower {
              value = ($tdr_tech_first != "") ? ($tdr_tech_first|to_lower) : "your tech"
            }
          
            // Appliance word, fallback to "appliance".
            var $cust_appl_word {
              value = ($tdr_job_appl != "") ? $tdr_job_appl : "appliance"
            }
          
            // Customer-facing diagnosis (from TDR we just created, NOT raw captured_data).
            // Truncate at 120 chars with "..." indicator; if not truncated, append period.
            var $cust_diag_raw {
              value = (($auto_tdr.customer_facing_diagnosis ?? "")|trim)
            }
          
            var $cust_diag_len {
              value = $cust_diag_raw|strlen
            }
          
            var $cust_diag_120 {
              value = ($cust_diag_len > 120) ? (($cust_diag_raw|substr:0:120) ~ "...") : $cust_diag_raw
            }
          
            var $cust_diag_phrase_end {
              value = ($cust_diag_len > 120) ? "" : "."
            }
          
            var $cust_diag_phrase {
              value = ($cust_diag_120 != "") ? (" heres what they found: " ~ $cust_diag_120 ~ $cust_diag_phrase_end) : ""
            }
          
            var $cust_sms_body {
              value = "hi " ~ $cust_display_name ~ " - " ~ $cust_tech_first_lower ~ " finished checking out your " ~ $cust_appl_word ~ "." ~ $cust_diag_phrase ~ " office will follow up shortly with next steps."
            }
          
            api.request {
              url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
              method = "POST"
              params = {to: $cust_phone_e164, message: $cust_sms_body}
              headers = ["Content-Type: application/json"]
              timeout = 30
            } as $cust_sms_resp
          
            db.add event_log {
              data = {
                action  : "tech_assist_diagnosis_complete_customer_sms"
                metadata: {
                session_id : $session.id
                job_id     : $session.job_id
                customer_id: $tdr_job.customer_id
                recipient  : $cust_phone_e164
                body_len   : $cust_sms_body|strlen
                truncated  : ($cust_diag_len > 120)
              }
              }
            } as $cust_sms_log
          }
        }
      
        db.add event_log {
          data = {
            action  : "tech_assist_auto_tdr_created"
            metadata: {
            session_id: $session.id
            job_id    : $session.job_id
            tdr_id    : $auto_tdr.id
            tech_id   : $session.technician_id
          }
          }
        } as $auto_tdr_log
      }
    }
  }

  response = {
    success   : true
    session_id: $session.id
    complete  : $is_complete
    status    : $new_status
    missing   : $remaining
  }

  guid = "cS-UMTHEL8nwxUmZAg8zlZa6gAY"
}