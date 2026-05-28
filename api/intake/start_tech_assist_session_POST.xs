// Phase 1b. Bootstrap a Tech Ant Assist live in-field session for a tech-job
// pair. Called from hcp_job_webhook on work_status=in_progress, gated on
// $env.TECH_ASSIST_ENABLED=="true". Idempotent on same (tech, job); auto-closes
// any prior active/awaiting_completion session for the same tech if it points
// at a different job. See docs/ant-tech-assist-design-v1.md.
query start_tech_assist_session verb=POST {
  api_group = "intake"

  input {
    int job_id
    int technician_id
    text? session_start_event?
  }

  stack {
    // ── 1. Resolve start event with fallback (footgun #3 + #8: hoist) ──
    var $start_event_in {
      value = ($input.session_start_event ?? "")|trim
    }
  
    var $start_event {
      value = ($start_event_in != "") ? $start_event_in : "hcp_in_progress"
    }
  
    // ── 2. Load job ──
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
  
    // ── 3. Load tech ──
    db.get technicians {
      field_name = "id"
      field_value = $input.technician_id
    } as $tech
  
    conditional {
      if ($tech == null) {
        return {
          value = {success: false, error: "tech not found"}
        }
      }
    }
  
    // ── 4. Load customer (may be null for HCP-sourced jobs without phone match) ──
    var $customer {
      value = null
    }
  
    conditional {
      if ($job.customer_id != null && $job.customer_id > 0) {
        db.get customer {
          field_name = "id"
          field_value = $job.customer_id
        } as $customer
      }
    }
  
    // Customer preferred-name fallback chain.
    var $cust_pref_raw {
      value = ($customer.preferred_name ?? "")|trim
    }
  
    var $cust_first_raw {
      value = ($customer.first_name ?? "")|trim
    }
  
    var $preferred_name {
      value = ($cust_pref_raw != "") ? $cust_pref_raw : (($cust_first_raw != "") ? $cust_first_raw : "there")
    }
  
    // ── 5. Idempotency + multijob auto-close ──
    db.query tech_assist_session {
      where = $db.tech_assist_session.technician_id == $input.technician_id && ($db.tech_assist_session.status == "active" || $db.tech_assist_session.status == "awaiting_completion")
      return = {type: "single"}
    } as $existing_session
  
    var $idempotent_hit {
      value = false
    }
  
    var $idempotent_session_id {
      value = 0
    }
  
    conditional {
      if ($existing_session != null) {
        conditional {
          if ($existing_session.job_id == $input.job_id) {
            var.update $idempotent_hit {
              value = true
            }
          
            var.update $idempotent_session_id {
              value = $existing_session.id
            }
          }
        
          else {
            db.edit tech_assist_session {
              field_name = "id"
              field_value = $existing_session.id
              data = {
                status      : "abandoned"
                escalated_at: now
                escalated_to: "auto_close_multijob"
                updated_at  : now
              }
            } as $closed_prior
          
            db.add event_log {
              data = {
                action  : "tech_assist_session_auto_closed"
                metadata: {
                prior_session_id: $existing_session.id
                prior_job_id    : $existing_session.job_id
                new_job_id      : $input.job_id
                technician_id   : $input.technician_id
              }
              }
            } as $auto_close_log
          }
        }
      }
    }
  
    // Idempotent re-entry: return existing session info immediately.
    conditional {
      if ($idempotent_hit) {
        db.query agent_conversation {
          where = $db.agent_conversation.assist_session_id == $idempotent_session_id
          return = {type: "single"}
        } as $existing_conv
      
        var $existing_conv_id {
          value = ($existing_conv != null) ? $existing_conv.id : 0
        }
      
        return {
          value = {
            success        : true
            session_id     : $idempotent_session_id
            conversation_id: $existing_conv_id
            opening_message: ""
            idempotent     : true
          }
        }
      }
    }
  
    // ── 6. Determine warranty_company + customer_type ──
    var $job_warranty_co {
      value = ($job.warranty_company ?? "")|trim
    }
  
    var $resolved_warranty_co {
      value = ($job_warranty_co != "") ? $job_warranty_co : "unknown"
    }
  
    var $job_cust_type {
      value = ($job.customer_type ?? "")|trim
    }
  
    var $resolved_cust_type {
      value = ($job_cust_type == "warranty" || $job_cust_type == "self_pay") ? $job_cust_type : "warranty"
    }
  
    // ── 7. Hardcoded required_fields_remaining for Phase 1b ──
    // Phase 1c will derive these from a warranty_company-keyed config table
    // after Danielle interview confirms per-portal field requirements.
    var $required_fields {
      value = [
        "model_confirmation"
        "symptom_confirmation"
        "diagnosis"
        "repair_completed_status"
      ]
    }
  
    // ── 8. Insert new tech_assist_session ──
    db.add tech_assist_session {
      data = {
        job_id                   : $input.job_id
        technician_id            : $input.technician_id
        warranty_company         : $resolved_warranty_co
        customer_type            : $resolved_cust_type
        status                   : "active"
        captured_data            : {}
        required_fields_remaining: $required_fields
        session_start_event      : $start_event
        last_message_at          : now
        updated_at               : now
      }
    } as $new_session
  
    // ── 9. Session URL ──
    var $job_id_str {
      value = $input.job_id|to_text
    }
  
    var $tech_id_str {
      value = $input.technician_id|to_text
    }
  
    var $session_url {
      value = "https://tnapplianceexchange.net/tech-ant-live.html?job_id=" ~ $job_id_str ~ "&tech_id=" ~ $tech_id_str
    }
  
    // ── 10. Build opening message ──
    // Brand resolution: jobs.brand -> jobs.appliance_brand -> "the appliance"
    var $brand_main {
      value = ($job.brand ?? "")|trim
    }
  
    var $brand_vapi {
      value = ($job.appliance_brand ?? "")|trim
    }
  
    var $brand_resolved {
      value = ($brand_main != "") ? $brand_main : (($brand_vapi != "") ? $brand_vapi : "the appliance")
    }
  
    var $appliance_type_str {
      value = ($job.appliance_type ?? "")|trim
    }
  
    // Brand + type clause: "whirlpool dishwasher" if both, "the appliance" if neither.
    var $brand_type_clause {
      value = ""
    }
  
    conditional {
      if ($brand_main != "" || $brand_vapi != "") {
        conditional {
          if ($appliance_type_str != "") {
            var.update $brand_type_clause {
              value = $brand_resolved ~ " " ~ $appliance_type_str
            }
          }
        
          else {
            var.update $brand_type_clause {
              value = $brand_resolved
            }
          }
        }
      }
    
      else {
        conditional {
          if ($appliance_type_str != "") {
            var.update $brand_type_clause {
              value = $appliance_type_str
            }
          }
        
          else {
            var.update $brand_type_clause {
              value = "the appliance"
            }
          }
        }
      }
    }
  
    // Customer last name for "at the X house"
    var $cust_last_raw {
      value = ($customer.last_name ?? "")|trim
    }
  
    var $at_house_clause {
      value = ($cust_last_raw != "") ? (" at the " ~ ($cust_last_raw|to_lower) ~ " house") : ""
    }
  
    // Model resolution: jobs.model_number -> jobs.appliance_model -> none
    var $model_main {
      value = ($job.model_number ?? "")|trim
    }
  
    var $model_vapi {
      value = ($job.appliance_model ?? "")|trim
    }
  
    var $model_resolved {
      value = ($model_main != "") ? $model_main : $model_vapi
    }
  
    var $model_clause {
      value = ($model_resolved != "") ? ("customer reported model " ~ $model_resolved) : "no model on file"
    }
  
    // Symptom resolution: problem_summary -> problem_description -> none
    var $symptom_main {
      value = ($job.problem_summary ?? "")|trim
    }
  
    var $symptom_vapi {
      value = ($job.problem_description ?? "")|trim
    }
  
    var $symptom_resolved {
      value = ($symptom_main != "") ? $symptom_main : $symptom_vapi
    }
  
    var $symptom_clause {
      value = ($symptom_resolved != "") ? (" + said " ~ ($symptom_resolved|to_lower)) : " + no specifics reported"
    }
  
    // Pre-diagnosis check: any existing TDR for this job authored by Teddy (tech_id 1)?
    db.query technician_decision_report {
      where = $db.technician_decision_report.job_id == $input.job_id && $db.technician_decision_report.technician_id == 1
      sort = {technician_decision_report.created_at: "desc"}
      return = {type: "single"}
    } as $teddy_tdr
  
    var $teddy_tdr_summary_raw {
      value = ($teddy_tdr.problem_summary ?? "")|trim
    }
  
    var $prediag_clause {
      value = ($teddy_tdr != null && $teddy_tdr_summary_raw != "") ? ("teddy's guess: " ~ ($teddy_tdr_summary_raw|to_lower) ~ ".") : "teddy hasnt pre-diagnosed yet."
    }
  
    // Tech first name for greeting (lowercase)
    var $tech_first_raw {
      value = ($tech.first_name ?? "")|trim
    }
  
    var $tech_first_lower {
      value = ($tech_first_raw != "") ? ($tech_first_raw|to_lower) : "tech"
    }
  
    var $opening_message {
      value = "🐜 hey " ~ $tech_first_lower ~ " - on the " ~ $brand_type_clause ~ $at_house_clause ~ ". " ~ $model_clause ~ $symptom_clause ~ ". " ~ $prediag_clause ~ " confirm the model first then text findings or open: " ~ $session_url ~ " - lmk if you want my help."
    }
  
    // ── 11. Send SMS to tech (best-effort; failure logs but does not abort) ──
    var $tech_phone_bare {
      value = ($tech.phone ?? "")|trim
    }
  
    conditional {
      if ($tech_phone_bare != "") {
        // ── SMS_ENABLED gate (call_site: start_tech_assist_session_POST.xs:326) ──
        var $gate326_recipient_e164 {
          value = "+1" ~ $tech_phone_bare
        }
      
        var $gate326_is_owner {
          value = ($gate326_recipient_e164 == "+16154855795") || ($tech_phone_bare == "6154855795")
        }
      
        var $gate326_sms_enabled {
          value = (($env.SMS_ENABLED ?? "false") == "true")
        }
      
        var $gate326_should_send {
          value = $gate326_sms_enabled || $gate326_is_owner
        }
      
        conditional {
          if ($gate326_should_send == false) {
            db.add event_log {
              data = {
                action  : "sms_gated"
                metadata: {
                recipient   : $gate326_recipient_e164
                body_preview: $opening_message|substr:0:200
                gated_reason: "SMS_ENABLED=false, non-owner recipient"
                call_site   : "start_tech_assist_session_POST.xs:326"
                session_id  : $new_session.id
                tech_id     : $input.technician_id
              }
              }
            } as $gate326_log
          }
        
          else {
            conditional {
              if ($gate326_is_owner && $gate326_sms_enabled == false) {
                db.add event_log {
                  data = {
                    action  : "sms_owner_bypass"
                    metadata: {
                    recipient   : $gate326_recipient_e164
                    body_preview: $opening_message|substr:0:200
                    call_site   : "start_tech_assist_session_POST.xs:326"
                    session_id  : $new_session.id
                    tech_id     : $input.technician_id
                  }
                  }
                } as $bypass326_log
              }
            }
          
            api.request {
              url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
              method = "POST"
              params = {to: "+1" ~ $tech_phone_bare, message: $opening_message}
              headers = ["Content-Type: application/json"]
              timeout = 30
            } as $sms_resp
          
            var $sms_action {
              value = "tech_assist_opening_sms_failed"
            }
          
            conditional {
              if (($sms_resp.response.status == 201) || ($sms_resp.response.status == 200)) {
                var.update $sms_action {
                  value = "tech_assist_opening_sms_sent"
                }
              }
            }
          
            db.add event_log {
              data = {
                action  : $sms_action
                metadata: {
                session_id : $new_session.id
                tech_id    : $input.technician_id
                status_code: $sms_resp.response.status
              }
              }
            } as $sms_log
          }
        }
      }
    }
  
    // ── 12. Create agent_conversation linked to this session ──
    db.add agent_conversation {
      data = {
        tech_id          : $input.technician_id
        channel          : "sms"
        title            : "Tech Assist - Job " ~ $job_id_str
        last_message_at  : "now"
        assist_session_id: $new_session.id
      }
    } as $new_conversation
  
    // ── 13. Opening message persistence — REMOVED 2026-05-28 per Teddy.
    // "The box that says hey teddy and gives a suggestion, remove that from
    // all dashboards. Kill that idea." The SMS to the tech (above) still
    // carries the briefing; the in-chat session starts empty so the
    // conversation has room to breathe.
  
    // ── 14. Audit ──
    db.add event_log {
      data = {
        action  : "tech_assist_session_started"
        metadata: {
        session_id      : $new_session.id
        job_id          : $input.job_id
        technician_id   : $input.technician_id
        warranty_company: $resolved_warranty_co
        customer_type   : $resolved_cust_type
        start_event     : $start_event
      }
      }
    } as $start_log
  }

  response = {
    success        : true
    session_id     : $new_session.id
    conversation_id: $new_conversation.id
    opening_message: $opening_message
    idempotent     : false
  }

  guid = "RPmYBGvReS_PBrNccICGIQ-rGcY"
}