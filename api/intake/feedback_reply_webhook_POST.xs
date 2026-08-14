// Receives inbound SMS replies from Twilio for customer feedback.
// Always return 200 OK to Twilio
query feedback_reply_webhook verb=POST {
  api_group = "intake"

  input {
    text From
    text Body
  }

  stack {
    // Step 1: detect PICK reply from owner.
    var $from_e164 {
      value = ($input.From ?? "")|trim
    }
  
    var $from_bare {
      value = $from_e164|replace:"+1":""
    }
  
    var $is_owner {
      value = ($from_e164 == "+16154855795") || ($from_bare == "6154855795")
    }
  
    var $body_upper {
      value = (($input.Body ?? "")|trim|to_upper)
    }
  
    var $is_pick {
      value = ($body_upper == "PICK1") || ($body_upper == "PICK2") || ($body_upper == "PICK3")
    }
  
    // ===== DANIELLE HANDLER (Phase 6 - parts ops commands) =====
    var $sender_is_danielle {
      value = ($from_e164 == "+16154850713") || ($from_bare == "6154850713")
    }
  
    conditional {
      if ($sender_is_danielle) {
        var $body_tokens {
          value = $body_upper|split:" "
        }
      
        var $body_token_count {
          value = $body_tokens|count
        }
      
        var $cmd {
          value = `($body_token_count > 0) ? ($body_tokens|get:0) : ""`
        }
      
        var $arg_job_id_str {
          value = `($body_token_count > 1) ? ($body_tokens|get:1) : ""`
        }
      
        // Command: ORDERED [job_id]
        conditional {
          if ($cmd == "ORDERED" && $arg_job_id_str != "") {
            db.query jobs {
              where = $db.jobs.id == $arg_job_id_str
              return = {type: "single"}
            } as $d_job
          
            conditional {
              if ($d_job == null) {
                var $ord_404_body {
                  value = "Job not found. Try: ORDERED 18094"
                }
              
                var $gate915_recipient_e164 {
                  value = $from_e164
                }
              
                var $gate915_sms_enabled {
                  value = (($env.SMS_ENABLED ?? "false") == "true")
                }
              
                var $gate915_is_danielle {
                  value = true
                }
              
                var $gate915_should_send {
                  value = $gate915_sms_enabled || $gate915_is_danielle
                }
              
                conditional {
                  if ($gate915_should_send) {
                    api.request {
                      url = "https://api.telnyx.com/v2/messages"
                      method = "POST"
                      params = {
                        from: $env.TELNYX_FROM_CUSTOMER
                        to  : $input.From
                        text: $ord_404_body
                      }
                    
                      headers = [
                        "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                        "Content-Type: application/json"
                      ]
                    } as $ord_404_sms
                  }
                }
              
                return {
                  value = {success: true}
                }
              }
            }
          
            db.edit jobs {
              field_name = "id"
              field_value = $d_job.id
              data = {parts_status: "ordered", parts_ordered_at: now}
            } as $d_job_updated
          
            db.get customer {
              field_name = "id"
              field_value = $d_job.customer_id
            } as $d_cust
          
            var $d_cust_name {
              value = (($d_cust.first_name ?? "")|trim) ~ " " ~ (($d_cust.last_name ?? "")|trim)
            }
          
            var $d_eta_disp {
              value = (($d_job.parts_eta_date ?? "")|trim)
            }
          
            conditional {
              if ($d_eta_disp == "") {
                var.update $d_eta_disp {
                  value = "(not set - send ETA " ~ ($d_job.id|to_text) ~ " [date])"
                }
              }
            }
          
            var $ord_ok_body {
              value = "Got it. Job #" ~ ($d_job.id|to_text) ~ " - " ~ $d_cust_name ~ " parts marked ordered. ETA: " ~ $d_eta_disp ~ ". I'll text the customer the day after arrival."
            }
          
            var $gate916_recipient_e164 {
              value = $from_e164
            }
          
            var $gate916_sms_enabled {
              value = (($env.SMS_ENABLED ?? "false") == "true")
            }
          
            var $gate916_is_danielle {
              value = true
            }
          
            var $gate916_should_send {
              value = $gate916_sms_enabled || $gate916_is_danielle
            }
          
            conditional {
              if ($gate916_should_send) {
                api.request {
                  url = "https://api.telnyx.com/v2/messages"
                  method = "POST"
                  params = {
                    from: $env.TELNYX_FROM_CUSTOMER
                    to  : $input.From
                    text: $ord_ok_body
                  }
                
                  headers = [
                    "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                    "Content-Type: application/json"
                  ]
                } as $ord_ok_sms
              }
            }
          
            db.add event_log {
              data = {
                action  : "parts_marked_ordered"
                metadata: {
                job_id        : $d_job.id
                customer_id   : $d_job.customer_id
                via           : "danielle_sms"
                parts_eta_date: $d_eta_disp
              }
              }
            } as $ord_log
          
            return {
              value = {success: true}
            }
          }
        }
      
        // Command: ETA [job_id] [date...]
        conditional {
          if ($cmd == "ETA" && $arg_job_id_str != "" && $body_token_count > 2) {
            var $eta_date_str {
              value = ""
            }
          
            var $eta_join_index {
              value = 0
            }
          
            foreach ($body_tokens) {
              each as $tk {
                conditional {
                  if ($eta_join_index >= 2) {
                    var.update $eta_date_str {
                      value = ($eta_date_str == "") ? $tk : ($eta_date_str ~ " " ~ $tk)
                    }
                  }
                }
              
                var.update $eta_join_index {
                  value = $eta_join_index + 1
                }
              }
            }
          
            db.query jobs {
              where = $db.jobs.id == $arg_job_id_str
              return = {type: "single"}
            } as $e_job
          
            conditional {
              if ($e_job == null) {
                var $eta_404_body {
                  value = "Job not found. Try: ETA 18094 2026-05-28"
                }
              
                var $gate917_sms_enabled {
                  value = (($env.SMS_ENABLED ?? "false") == "true")
                }
              
                var $gate917_is_danielle {
                  value = true
                }
              
                var $gate917_should_send {
                  value = $gate917_sms_enabled || $gate917_is_danielle
                }
              
                conditional {
                  if ($gate917_should_send) {
                    api.request {
                      url = "https://api.telnyx.com/v2/messages"
                      method = "POST"
                      params = {
                        from: $env.TELNYX_FROM_CUSTOMER
                        to  : $input.From
                        text: $eta_404_body
                      }
                    
                      headers = [
                        "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                        "Content-Type: application/json"
                      ]
                    } as $eta_404_sms
                  }
                }
              
                return {
                  value = {success: true}
                }
              }
            }
          
            db.edit jobs {
              field_name = "id"
              field_value = $e_job.id
              data = {parts_eta_date: $eta_date_str}
            } as $e_job_updated
          
            var $eta_ok_body {
              value = "Updated. Job #" ~ ($e_job.id|to_text) ~ " ETA set to " ~ $eta_date_str ~ "."
            }
          
            var $gate918_sms_enabled {
              value = (($env.SMS_ENABLED ?? "false") == "true")
            }
          
            var $gate918_is_danielle {
              value = true
            }
          
            var $gate918_should_send {
              value = $gate918_sms_enabled || $gate918_is_danielle
            }
          
            conditional {
              if ($gate918_should_send) {
                api.request {
                  url = "https://api.telnyx.com/v2/messages"
                  method = "POST"
                  params = {
                    from: $env.TELNYX_FROM_CUSTOMER
                    to  : $input.From
                    text: $eta_ok_body
                  }
                
                  headers = [
                    "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                    "Content-Type: application/json"
                  ]
                } as $eta_ok_sms
              }
            }
          
            db.add event_log {
              data = {
                action  : "parts_eta_updated"
                metadata: {
                job_id  : $e_job.id
                eta_date: $eta_date_str
                via     : "danielle_sms"
              }
              }
            } as $eta_log
          
            return {
              value = {success: true}
            }
          }
        }
      
        // Danielle but no matching command: send help reply.
        var $help_body {
          value = "Hi Danielle! Commands: ORDERED [job_id] or ETA [job_id] [date]"
        }
      
        var $gate919_sms_enabled {
          value = (($env.SMS_ENABLED ?? "false") == "true")
        }
      
        var $gate919_is_danielle {
          value = true
        }
      
        var $gate919_should_send {
          value = $gate919_sms_enabled || $gate919_is_danielle
        }
      
        conditional {
          if ($gate919_should_send) {
            api.request {
              url = "https://api.telnyx.com/v2/messages"
              method = "POST"
              params = {
                from: $env.TELNYX_FROM_CUSTOMER
                to  : $input.From
                text: $help_body
              }
            
              headers = [
                "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                "Content-Type: application/json"
              ]
            } as $help_sms
          }
        }
      
        db.add event_log {
          data = {
            action  : "danielle_help_reply"
            metadata: {from: $input.From, body: $input.Body}
          }
        } as $help_log
      
        return {
          value = {success: true}
        }
      }
    }
  
    // ===== PICK HANDLER =====
    conditional {
      if (($is_owner) && ($is_pick)) {
        var $pick_index {
          value = 0
        }
      
        conditional {
          if ($body_upper == "PICK2") {
            var.update $pick_index {
              value = 1
            }
          }
        
          elseif ($body_upper == "PICK3") {
            var.update $pick_index {
              value = 2
            }
          }
        }
      
        db.query broadcast_attempt {
          where = $db.broadcast_attempt.broadcast_type == "must_time_proposal" && $db.broadcast_attempt.status == "open"
          sort = {broadcast_attempt.created_at: "desc"}
          return = {type: "single"}
        } as $proposal
      
        conditional {
          if ($proposal == null) {
            var $no_prop_body {
              value = "No open proposals found."
            }
          
            var $gate913_recipient_e164 {
              value = $from_e164
            }
          
            var $gate913_recipient_bare {
              value = $from_bare
            }
          
            var $gate913_is_owner {
              value = ($gate913_recipient_e164 == "+16154855795") || ($gate913_recipient_bare == "6154855795")
            }
          
            var $gate913_sms_enabled {
              value = (($env.SMS_ENABLED ?? "false") == "true")
            }
          
            var $gate913_should_send {
              value = $gate913_sms_enabled || $gate913_is_owner
            }
          
            conditional {
              if ($gate913_should_send) {
                api.request {
                  url = "https://api.telnyx.com/v2/messages"
                  method = "POST"
                  params = {
                    from: $env.TELNYX_FROM_CUSTOMER
                    to  : $input.From
                    text: $no_prop_body
                  }
                
                  headers = [
                    "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                    "Content-Type: application/json"
                  ]
                } as $no_prop_sms
              }
            }
          
            db.add event_log {
              data = {
                action  : "pick_no_open_proposal"
                metadata: {from: $input.From, body: $input.Body}
              }
            } as $pick_no_prop_log
          
            return {
              value = {success: true}
            }
          }
        }
      
        var $chosen {
          value = null
        }
      
        conditional {
          if ($pick_index == 0) {
            var.update $chosen {
              value = $proposal.techs_notified|get:0
            }
          }
        
          elseif ($pick_index == 1) {
            var.update $chosen {
              value = $proposal.techs_notified|get:1
            }
          }
        
          elseif ($pick_index == 2) {
            var.update $chosen {
              value = $proposal.techs_notified|get:2
            }
          }
        }
      
        conditional {
          if ($chosen == null) {
            var $bad_index_body {
              value = "Invalid option number. Reply PICK1, PICK2, or PICK3."
            }
          
            var $gate914_recipient_e164 {
              value = $from_e164
            }
          
            var $gate914_recipient_bare {
              value = $from_bare
            }
          
            var $gate914_is_owner {
              value = ($gate914_recipient_e164 == "+16154855795") || ($gate914_recipient_bare == "6154855795")
            }
          
            var $gate914_sms_enabled {
              value = (($env.SMS_ENABLED ?? "false") == "true")
            }
          
            var $gate914_should_send {
              value = $gate914_sms_enabled || $gate914_is_owner
            }
          
            conditional {
              if ($gate914_should_send) {
                api.request {
                  url = "https://api.telnyx.com/v2/messages"
                  method = "POST"
                  params = {
                    from: $env.TELNYX_FROM_CUSTOMER
                    to  : $input.From
                    text: $bad_index_body
                  }
                
                  headers = [
                    "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                    "Content-Type: application/json"
                  ]
                } as $bad_index_sms
              }
            }
          
            db.add event_log {
              data = {
                action  : "pick_bad_index"
                metadata: {
                from         : $input.From
                body         : $input.Body
                pick_index   : $pick_index
                proposal_id  : $proposal.id
                options_count: $proposal.techs_notified|count
              }
              }
            } as $pick_bad_log
          
            return {
              value = {success: true}
            }
          }
        }
      
        db.get jobs {
          field_name = "id"
          field_value = $proposal.job_id
        } as $job
      
        db.get customer {
          field_name = "id"
          field_value = $job.customer_id
        } as $customer
      
        db.get technicians {
          field_name = "id"
          field_value = $chosen.tech_id
        } as $chosen_tech
      
        var $scheduled_start {
          value = (($chosen.date ~ " 08:00:00")|to_timestamp)|transform_timestamp:"+5 hours"
        }
      
        db.edit jobs {
          field_name = "id"
          field_value = $proposal.job_id
          data = {
            technician_id     : $chosen.tech_id
            scheduled_start   : $scheduled_start
            service_eta_window: $chosen.window
            scheduling_status : "scheduled"
            dispatch_status   : "accepted"
          }
        } as $job_updated
      
        db.edit broadcast_attempt {
          field_name = "id"
          field_value = $proposal.id
          data = {
            status            : "claimed"
            claimed_by_tech_id: $chosen.tech_id
            claimed_at        : now
          }
        } as $proposal_claimed
      
        var $cust_first_pk {
          value = (($customer.first_name ?? "")|trim)
        }
      
        var $appl_pk {
          value = (($job.appliance_type ?? "")|trim)
        }
      
        var $tech_first_pk {
          value = (($chosen_tech.first_name ?? "")|trim)
        }
      
        var $window_pk {
          value = (($chosen.window ?? "")|trim)
        }
      
        var $day_disp_pk {
          value = (($chosen.day_display ?? "")|trim)
        }
      
        var $cust_body {
          value = "Hi " ~ $cust_first_pk ~ ", your " ~ $appl_pk ~ " repair is confirmed for " ~ $day_disp_pk ~ " between " ~ $window_pk ~ ". " ~ $tech_first_pk ~ " will be your technician. You will get a text when he is on his way. Questions? Just reply here."
        }
      
        var $gate910_recipient_e164 {
          value = (($customer.phone ?? "")|trim)
        }
      
        var $gate910_recipient_bare {
          value = $gate910_recipient_e164|replace:"+1":""
        }
      
        var $gate910_is_owner {
          value = ($gate910_recipient_e164 == "+16154855795") || ($gate910_recipient_bare == "6154855795")
        }
      
        var $gate910_sms_enabled {
          value = (($env.SMS_ENABLED ?? "false") == "true")
        }
      
        var $gate910_should_send {
          value = $gate910_sms_enabled || $gate910_is_owner
        }
      
        conditional {
          if ($gate910_should_send == false) {
            db.add event_log {
              data = {
                action  : "sms_gated"
                metadata: {
                recipient   : $gate910_recipient_e164
                body_preview: $cust_body|substr:0:200
                gated_reason: "SMS_ENABLED=false, non-owner recipient"
                call_site   : "feedback_reply_webhook_POST.xs:pick-customer"
                job_id      : $proposal.job_id
              }
              }
            } as $gate910_log
          }
        
          else {
            conditional {
              if ($gate910_is_owner && $gate910_sms_enabled == false) {
                db.add event_log {
                  data = {
                    action  : "sms_owner_bypass"
                    metadata: {
                    recipient   : $gate910_recipient_e164
                    body_preview: $cust_body|substr:0:200
                    call_site   : "feedback_reply_webhook_POST.xs:pick-customer"
                    job_id      : $proposal.job_id
                  }
                  }
                } as $bypass910_log
              }
            }
          
            api.request {
              url = "https://api.telnyx.com/v2/messages"
              method = "POST"
              params = {
                from: $env.TELNYX_FROM_CUSTOMER
                to  : $customer.phone
                text: $cust_body
              }
            
              headers = [
                "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                "Content-Type: application/json"
              ]
            } as $cust_sms
          }
        }
      
        var $cust_last_pk {
          value = (($customer.last_name ?? "")|trim)
        }
      
        var $svc_addr_pk {
          value = (($job.service_address ?? "")|trim)
        }
      
        var $svc_city_pk {
          value = (($job.service_city ?? "")|trim)
        }
      
        var $problem_pk {
          value = (($job.problem_summary ?? "")|trim)
        }
      
        var $cust_pref_pk {
          value = (($job.customer_preference_text ?? "")|trim)
        }
      
        var $tech_body {
          value = "New job confirmed: " ~ $cust_first_pk ~ " " ~ $cust_last_pk ~ ", " ~ $svc_addr_pk ~ ", " ~ $svc_city_pk ~ ". " ~ $appl_pk ~ " - " ~ $problem_pk ~ ". Date: " ~ $day_disp_pk ~ " " ~ $window_pk ~ "."
        }
      
        conditional {
          if ($cust_pref_pk != "") {
            var.update $tech_body {
              value = $tech_body ~ " Customer note: " ~ $cust_pref_pk
            }
          }
        }
      
        var $gate911_recipient_e164 {
          value = "+1" ~ (($chosen_tech.phone ?? "")|trim)
        }
      
        var $gate911_recipient_bare {
          value = (($chosen_tech.phone ?? "")|trim)
        }
      
        var $gate911_is_owner {
          value = ($gate911_recipient_e164 == "+16154855795") || ($gate911_recipient_bare == "6154855795")
        }
      
        var $gate911_sms_enabled {
          value = (($env.SMS_ENABLED ?? "false") == "true")
        }
      
        var $gate911_should_send {
          value = $gate911_sms_enabled || $gate911_is_owner
        }
      
        conditional {
          if ($gate911_should_send == false) {
            db.add event_log {
              data = {
                action  : "sms_gated"
                metadata: {
                recipient   : $gate911_recipient_e164
                body_preview: $tech_body|substr:0:200
                gated_reason: "SMS_ENABLED=false, non-owner recipient"
                call_site   : "feedback_reply_webhook_POST.xs:pick-tech"
                job_id      : $proposal.job_id
                tech_id     : $chosen.tech_id
              }
              }
            } as $gate911_log
          }
        
          else {
            conditional {
              if ($gate911_is_owner && $gate911_sms_enabled == false) {
                db.add event_log {
                  data = {
                    action  : "sms_owner_bypass"
                    metadata: {
                    recipient   : $gate911_recipient_e164
                    body_preview: $tech_body|substr:0:200
                    call_site   : "feedback_reply_webhook_POST.xs:pick-tech"
                    job_id      : $proposal.job_id
                    tech_id     : $chosen.tech_id
                  }
                  }
                } as $bypass911_log
              }
            }
          
            api.request {
              url = "https://api.telnyx.com/v2/messages"
              method = "POST"
              params = {
                from: $env.TELNYX_FROM_CUSTOMER
                to  : $gate911_recipient_e164
                text: $tech_body
              }
            
              headers = [
                "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                "Content-Type: application/json"
              ]
            } as $tech_sms
          }
        }
      
        db.add event_log {
          data = {
            action  : "proposal_accepted"
            metadata: {
            job_id       : $proposal.job_id
            tech_id      : $chosen.tech_id
            option_index : $pick_index
            chosen_date  : $chosen.date
            chosen_window: $chosen.window
            proposal_id  : $proposal.id
          }
          }
        } as $proposal_accepted_log
      
        var $reply_body {
          value = "Done. " ~ $tech_first_pk ~ " confirmed for " ~ $cust_first_pk ~ " on " ~ $day_disp_pk ~ " " ~ $window_pk ~ ". Customer and tech both notified."
        }
      
        var $gate912_recipient_e164 {
          value = $from_e164
        }
      
        var $gate912_recipient_bare {
          value = $from_bare
        }
      
        var $gate912_is_owner {
          value = ($gate912_recipient_e164 == "+16154855795") || ($gate912_recipient_bare == "6154855795")
        }
      
        var $gate912_sms_enabled {
          value = (($env.SMS_ENABLED ?? "false") == "true")
        }
      
        var $gate912_should_send {
          value = $gate912_sms_enabled || $gate912_is_owner
        }
      
        conditional {
          if ($gate912_should_send == false) {
            db.add event_log {
              data = {
                action  : "sms_gated"
                metadata: {
                recipient   : $gate912_recipient_e164
                body_preview: $reply_body|substr:0:200
                gated_reason: "SMS_ENABLED=false, non-owner recipient"
                call_site   : "feedback_reply_webhook_POST.xs:pick-reply"
                job_id      : $proposal.job_id
              }
              }
            } as $gate912_log
          }
        
          else {
            conditional {
              if ($gate912_is_owner && $gate912_sms_enabled == false) {
                db.add event_log {
                  data = {
                    action  : "sms_owner_bypass"
                    metadata: {
                    recipient   : $gate912_recipient_e164
                    body_preview: $reply_body|substr:0:200
                    call_site   : "feedback_reply_webhook_POST.xs:pick-reply"
                    job_id      : $proposal.job_id
                  }
                  }
                } as $bypass912_log
              }
            }
          
            api.request {
              url = "https://api.telnyx.com/v2/messages"
              method = "POST"
              params = {
                from: $env.TELNYX_FROM_CUSTOMER
                to  : $input.From
                text: $reply_body
              }
            
              headers = [
                "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                "Content-Type: application/json"
              ]
            } as $reply_sms
          }
        }
      
        return {
          value = {success: true}
        }
      }
    }
  
    // Existing feedback flow
    db.query customer {
      where = $db.customer.phone == $input.From
      sort = {id: "desc"}
      return = {type: "single"}
    } as $customer
  
    conditional {
      if ($customer == null) {
        db.add event_log {
          data = {
            action  : "feedback_reply_no_customer"
            metadata: {from: $input.From, body: $input.Body}
          }
        }
      
        return {
          value = {success: true}
        }
      }
    }
  
    db.query jobs {
      where = $db.jobs.customer_id == $customer.id && $db.jobs.feedback_sent == true && (($db.jobs.feedback_type == null) || ($db.jobs.feedback_type == ""))
      sort = {created_at: "desc"}
      return = {type: "single"}
    } as $job
  
    conditional {
      if ($job == null) {
        db.add event_log {
          data = {
            action  : "feedback_reply_no_job"
            metadata: {from: $input.From, body: $input.Body}
          }
        }
      
        return {
          value = {success: true}
        }
      }
    }
  
    ai.agent.run feedback_classifier {
      args = {body: $input.Body}
      allow_tool_execution = false
    } as $ai_result
  
    var $raw_result {
      value = $ai_result.result ?? ""
    }
  
    var $cleaned_result {
      value = ($raw_result|replace:"```json":""|replace:"```":"")|trim
    }
  
    var $classification {
      value = $cleaned_result|json_decode
    }
  
    var $feedback_type {
      value = $classification.feedback_type ?? "unknown"
    }
  
    db.patch jobs {
      field_name = "id"
      field_value = $job.id
      data = {
        feedback_type: $feedback_type
        feedback_note: $input.Body
      }
    }
  
    conditional {
      if ($feedback_type == "positive") {
        var $pos_body {
          value = "That's awesome to hear! Would you mind leaving us a quick Google review? It means the world to a small business like ours and helps other families find us. https://g.page/r/CRt-vo--eAJ3EBM/review Thank you so much - we appreciate you!"
        }
      
        var $gate70_recipient_e164 {
          value = ($input.From ?? "")|trim
        }
      
        var $gate70_recipient_bare {
          value = $gate70_recipient_e164|replace:"+1":""
        }
      
        var $gate70_is_owner {
          value = ($gate70_recipient_e164 == "+16154855795") || ($gate70_recipient_bare == "6154855795")
        }
      
        var $gate70_sms_enabled {
          value = (($env.SMS_ENABLED ?? "false") == "true")
        }
      
        var $gate70_should_send {
          value = $gate70_sms_enabled || $gate70_is_owner
        }
      
        conditional {
          if ($gate70_should_send == false) {
            db.add event_log {
              data = {
                action  : "sms_gated"
                metadata: {
                recipient   : $gate70_recipient_e164
                body_preview: $pos_body|substr:0:200
                gated_reason: "SMS_ENABLED=false, non-owner recipient"
                call_site   : "feedback_reply_webhook_POST.xs:70"
              }
              }
            } as $gate70_log
          }
        
          else {
            conditional {
              if ($gate70_is_owner && $gate70_sms_enabled == false) {
                db.add event_log {
                  data = {
                    action  : "sms_owner_bypass"
                    metadata: {
                    recipient   : $gate70_recipient_e164
                    body_preview: $pos_body|substr:0:200
                    call_site   : "feedback_reply_webhook_POST.xs:70"
                  }
                  }
                } as $bypass70_log
              }
            }
          
            api.request {
              url = "https://api.telnyx.com/v2/messages"
              method = "POST"
              params = {
                from: $env.TELNYX_FROM_CUSTOMER
                to  : $input.From
                text: $pos_body
              }
            
              headers = [
                "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                "Content-Type: application/json"
              ]
            }
          }
        }
      
        db.patch jobs {
          field_name = "id"
          field_value = $job.id
          data = {review_link_sent: true}
        }
      }
    
      elseif ($feedback_type == "negative") {
        var $neg_body {
          value = "We're really sorry to hear that. That's not the experience we want for you. Please tell us what happened and how we could have done better - your feedback goes directly to the owner."
        }
      
        var $gate99_recipient_e164 {
          value = ($input.From ?? "")|trim
        }
      
        var $gate99_recipient_bare {
          value = $gate99_recipient_e164|replace:"+1":""
        }
      
        var $gate99_is_owner {
          value = ($gate99_recipient_e164 == "+16154855795") || ($gate99_recipient_bare == "6154855795")
        }
      
        var $gate99_sms_enabled {
          value = (($env.SMS_ENABLED ?? "false") == "true")
        }
      
        var $gate99_should_send {
          value = $gate99_sms_enabled || $gate99_is_owner
        }
      
        conditional {
          if ($gate99_should_send == false) {
            db.add event_log {
              data = {
                action  : "sms_gated"
                metadata: {
                recipient   : $gate99_recipient_e164
                body_preview: $neg_body|substr:0:200
                gated_reason: "SMS_ENABLED=false, non-owner recipient"
                call_site   : "feedback_reply_webhook_POST.xs:99"
              }
              }
            } as $gate99_log
          }
        
          else {
            conditional {
              if ($gate99_is_owner && $gate99_sms_enabled == false) {
                db.add event_log {
                  data = {
                    action  : "sms_owner_bypass"
                    metadata: {
                    recipient   : $gate99_recipient_e164
                    body_preview: $neg_body|substr:0:200
                    call_site   : "feedback_reply_webhook_POST.xs:99"
                  }
                  }
                } as $bypass99_log
              }
            }
          
            api.request {
              url = "https://api.telnyx.com/v2/messages"
              method = "POST"
              params = {
                from: $env.TELNYX_FROM_CUSTOMER
                to  : $input.From
                text: $neg_body
              }
            
              headers = [
                "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                "Content-Type: application/json"
              ]
            }
          }
        }
      
        db.get customer {
          field_name = "id"
          field_value = $job.customer_id
        } as $customer
      
        var $tech_name {
          value = "Unknown"
        }
      
        conditional {
          if ($job.technician_id != null) {
            db.get technicians {
              field_name = "id"
              field_value = $job.technician_id
            } as $tech
          
            var.update $tech_name {
              value = ($tech.first_name ?? "") ~ " " ~ ($tech.last_name ?? "")
            }
          }
        }
      
        var $owner_msg {
          value = "NEGATIVE FEEDBACK\nJob: " ~ ($job.id|to_text) ~ "\nCustomer: " ~ ($customer.first_name ?? "") ~ " " ~ ($customer.last_name ?? "") ~ "\nTech: " ~ $tech_name ~ "\nMessage: " ~ $input.Body
        }
      
        var $gate146_recipient_e164 {
          value = "+16154855795"
        }
      
        var $gate146_is_owner {
          value = true
        }
      
        var $gate146_sms_enabled {
          value = (($env.SMS_ENABLED ?? "false") == "true")
        }
      
        var $gate146_should_send {
          value = $gate146_sms_enabled || $gate146_is_owner
        }
      
        conditional {
          if ($gate146_should_send == false) {
            db.add event_log {
              data = {
                action  : "sms_gated"
                metadata: {
                recipient   : $gate146_recipient_e164
                body_preview: $owner_msg|substr:0:200
                gated_reason: "SMS_ENABLED=false, non-owner recipient"
                call_site   : "feedback_reply_webhook_POST.xs:146"
              }
              }
            } as $gate146_log
          }
        
          else {
            conditional {
              if ($gate146_is_owner && $gate146_sms_enabled == false) {
                db.add event_log {
                  data = {
                    action  : "sms_owner_bypass"
                    metadata: {
                    recipient   : $gate146_recipient_e164
                    body_preview: $owner_msg|substr:0:200
                    call_site   : "feedback_reply_webhook_POST.xs:146"
                  }
                  }
                } as $bypass146_log
              }
            }
          
            api.request {
              url = "https://api.telnyx.com/v2/messages"
              method = "POST"
              params = {
                from: $env.TELNYX_FROM_CUSTOMER
                to  : "+16154855795"
                text: $owner_msg
              }
            
              headers = [
                "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                "Content-Type: application/json"
              ]
            }
          }
        }
      }
    
      elseif ($feedback_type == "unknown") {
        db.add event_log {
          data = {
            action  : "feedback_unknown"
            metadata: {body: $input.Body, job_id: $job.id}
          }
        }
      }
    }
  }

  response = {success: true}
  guid = "EdN7By9SxGVqV-5RW1ZEDGJ36go"
}