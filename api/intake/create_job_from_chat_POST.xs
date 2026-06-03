// Creates a new job from direct chat input, with automated routing and HCP integration.
query create_job_from_chat verb=POST {
  api_group = "intake"

  input {
    text first_name
    text? last_name?
    text phone
    text zip
    text? appliance_type?
    text? brand?
    text? model_number?
    text problem_summary
    text? recommended_service?
    text channel
    text? customer_preference_text?
    text? scheduling_type?
    bool? sms_consent?
    timestamp? sms_consent_at?
    text? customer_type?
    text? warranty_company?
    text? claim_number?
    text? dispatch_source_id?
    text? serial_number?
    int? conversation_id?
  }

  stack {
    var $recommended_service {
      value = $input.recommended_service|first_notempty:"quick_check"
    }
  
    var $customer_type {
      value = $input.customer_type|first_notempty:"self_pay"
    }
  
    var $payment_status {
      value = "unpaid"
    }
  
    conditional {
      if ($customer_type == "warranty") {
        var.update $payment_status {
          value = "warranty_pending"
        }
      }
    }
  
    db.query customer {
      where = $db.customer.phone == $input.phone
      return = {type: "single"}
    } as $existing_customer
  
    conditional {
      if ($existing_customer == null) {
        db.add customer {
          data = {
            first_name: $input.first_name
            last_name : $input.last_name
            phone     : $input.phone
            zip       : $input.zip
          }
        } as $customer
      }
    
      else {
        var $customer {
          value = $existing_customer
        }
      }
    }
  
    db.add jobs {
      data = {
        customer_id             : $customer.id
        job_number              : null
        current_status          : "pending"
        friendly_status         : "Pending Review"
        problem_summary         : $input.problem_summary
        appliance_type          : $input.appliance_type
        service_zip             : $input.zip
        brand                   : $input.brand
        model_number            : $input.model_number
        payment_status          : $payment_status
        source_type             : "web_chat"
        source_agent            : "ant"
        customer_type           : $customer_type
        warranty_company        : $input.warranty_company
        claim_number            : $input.claim_number
        dispatch_source_id      : $input.dispatch_source_id
        serial_number           : $input.serial_number
        recommended_service     : $recommended_service
        job_status              : "submitted"
        triage_status           : "not_reviewed"
        parts_status            : "not_needed"
        scheduling_status       : "not_ready"
        intake_source           : "web_chat"
        waiver_channel          : $input.channel
        customer_preference_text: $input.customer_preference_text
        scheduling_type         : $input.scheduling_type
        sms_consent             : $input.sms_consent
        sms_consent_at          : $input.sms_consent_at
      }
    } as $new_job
  
    conditional {
      if ($recommended_service == "quick_check") {
        db.edit jobs {
          field_name = "id"
          field_value = $new_job.id
          data = {technician_id: 1, triage_status: "routed"}
        } as $new_job
      }
    
      elseif ($recommended_service == "premium_call") {
        db.edit jobs {
          field_name = "id"
          field_value = $new_job.id
          data = {technician_id: 1, triage_status: "routed"}
        } as $new_job
      }
    
      else {
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/get_tech_for_zip"
          method = "POST"
          params = {zip_code: $input.zip, waiver_signed: false}
          headers = ["Content-Type: application/json"]
        } as $routing_response
      
        var $routing_result {
          value = $routing_response.response.result
        }
      
        conditional {
          if ($routing_result.status == "assigned") {
            db.edit jobs {
              field_name = "id"
              field_value = $new_job.id
              data = {
                technician_id: $routing_result.technician_id
                triage_status: "routed"
              }
            } as $new_job
          }
        
          elseif ($routing_result.status == "reject_zone") {
            db.edit jobs {
              field_name = "id"
              field_value = $new_job.id
              data = {
                triage_status  : "needs_review"
                current_status : "out_of_area"
                friendly_status: "Out of Service Area"
              }
            } as $new_job
          }
        
          elseif ($routing_result.status == "queue_for_later") {
            db.edit jobs {
              field_name = "id"
              field_value = $new_job.id
              data = {
                triage_status  : "needs_tech_assignment"
                current_status : "needs_tech_assignment"
                friendly_status: "Awaiting Tech Assignment"
              }
            } as $new_job
          }
        }
      }
    }
  
    conditional {
      if ($input.conversation_id != null) {
        db.query job_attachments {
          where = $db.job_attachments.conversation_id == $input.conversation_id && $db.job_attachments.job_id == null
          return = {type: "list", paging: {page: 1, per_page: 100}}
        } as $orphan_attachments
      
        var $linked_count {
          value = 0
        }
      
        foreach ($orphan_attachments.items) {
          each as $att {
            db.edit job_attachments {
              field_name = "id"
              field_value = $att.id
              data = {job_id: $new_job.id}
            } as $linked_att
          
            var.update $linked_count {
              value = $linked_count + 1
            }
          }
        }
      
        db.add job_event {
          data = {
            job_id      : $new_job.id
            event_type  : "chat_attachments_linked"
            event_source: "web_chat"
            event_notes : ($linked_count|to_text) ~ " attachments linked from conversation " ~ ($input.conversation_id|to_text)
            created_by  : "system"
          }
        } as $link_event
      }
    }
  
    db.add job_financial {
      data = {job_id: $new_job.id, payment_status: $payment_status}
    } as $new_job_financial
  
    db.add job_event {
      data = {
        job_id      : $new_job.id
        event_type  : "intake_created"
        event_source: "web_chat"
        created_by  : "system"
      }
    } as $new_job_event
  
    db.add job_event {
      data = {
        job_id      : $new_job.id
        event_type  : "hcp_sync_pending"
        event_source: "web_chat"
        created_by  : "system"
      }
    } as $hcp_sync_event
  
    // Phase B: emit JOB_CREATED for colony loop greeting (see docs/colony-loop-design.md section 16).
    var $jc_phone {
      value = $input.phone
    }
  
    var $jc_first {
      value = $input.first_name
    }
  
    var $jc_appliance {
      value = ($input.appliance_type ?? "")
    }
  
    var $jc_payload_obj {
      value = {
        job_id             : $new_job.id
        customer_phone     : $jc_phone
        customer_first_name: $jc_first
        appliance_type     : $jc_appliance
        source             : "web_chat"
        customer_type      : $customer_type
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
        source   : "web_chat"
      }
      }
    } as $jc_log
  
    var $should_enqueue {
      value = ($customer_type != "warranty")
    }
  
    conditional {
      if ($should_enqueue) {
        var $queue_action {
          value = "broadcast"
        }
      
        conditional {
          if (($input.scheduling_type == "must_time") || ($input.scheduling_type == "emergency")) {
            var.update $queue_action {
              value = "propose"
            }
          }
        }
      
        // Auto-enqueue retired 2026-06-01. Mock-scheduler reads jobs
        // directly. See ahs_email_intake_POST for the same pattern.
        var $cjfc_sq_enabled {
          value = (($env.SCHEDULING_QUEUE_ENABLED ?? "false") == "true")
        }

        conditional {
          if ($cjfc_sq_enabled == true) {
            db.add scheduling_queue {
              data = {
                job_id      : $new_job.id
                action_type : $queue_action
                status      : "pending"
                result_notes: "auto-enqueued from chat intake"
              }
            } as $new_queue_row
          }
        }
      
        db.add job_event {
          data = {
            job_id      : $new_job.id
            event_type  : "scheduling_queued"
            event_source: "web_chat"
            event_notes : "Action: " ~ $queue_action ~ " (queue_id=" ~ ($new_queue_row.id|to_text) ~ ")"
            created_by  : "system"
          }
        } as $queued_event
      }
    }
  
    // Wire 2: notify Teddy when Ant intake completes a new chat job.
    // Always fires (gate_t2_is_owner = true) but wrapped in SMS_ENABLED-or-owner
    // gate for consistency with other call sites. Body summarizes the new job
    // and includes a deep link to the Teddy cockpit pre-filled with the job_id.
    var $teddy_cust_name {
      value = (($customer.first_name ?? "")|trim) ~ " " ~ (($customer.last_name ?? "")|trim)
    }
  
    var $teddy_appl {
      value = (($new_job.appliance_type ?? "")|trim)
    }
  
    var $teddy_brand {
      value = (($new_job.brand ?? "")|trim)
    }
  
    var $teddy_problem {
      value = (($new_job.problem_summary ?? "")|substr:0:100)
    }
  
    var $teddy_job_id {
      value = $new_job.id|to_text
    }
  
    var $teddy_sms_body {
      value = "New job #" ~ $teddy_job_id ~ " - " ~ $teddy_cust_name ~ "\n" ~ $teddy_brand ~ " " ~ $teddy_appl ~ "\nIssue: " ~ $teddy_problem ~ "\n\nTeddy Tool:\nhttps://tnapplianceexchange.net/teddy-tdr-tool.html?job_id=" ~ $teddy_job_id
    }
  
    var $gate_t2_sms_enabled {
      value = (($env.SMS_ENABLED ?? "false") == "true")
    }
  
    var $gate_t2_is_owner {
      value = true
    }
  
    var $gate_t2_should_send {
      value = $gate_t2_sms_enabled || $gate_t2_is_owner
    }
  
    conditional {
      if ($gate_t2_should_send) {
        api.request {
          url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
          method = "POST"
          params = {
            From: "+16292840444"
            To  : $env.OWNER_PHONE_NUMBER
            Body: $teddy_sms_body
          }
        
          headers = [
            "Authorization: Basic " ~ (($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode)
            "Content-Type: application/x-www-form-urlencoded"
          ]
        } as $teddy_notify_sms
      }
    }
  }

  response = $new_job
  guid = "hZIekcAvfGJuh7-swMn6kNnWg7I"
}