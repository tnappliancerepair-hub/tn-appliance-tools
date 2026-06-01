//  ServicePower email intake. Phase A1 endpoint. Receives a pre-parsed
//  payload from netlify/functions/servicepower-gmail-poller.js (Netlify-
//  side parser; per Phase A1 architecture decision, parser lives in JS
//  not XanoScript to avoid footgun #28 regex_replace pain).
// 
//  Decisions implemented (per Phase A1 lock-in):
//    - SMART DEDUP: first email for a Call # creates job; subsequent
//      emails log to job_email_event and may trigger field updates.
//    - Customer dedup: composite (phone + address) signature. Three-way
//      decision: REUSE / NEW with related_customer_id / NEW alone.
//    - Partial dedup: PHONE_ONLY -> flag job + log; ADDR_ONLY -> same;
//      BOTH FAIL -> flag + send Danielle alert email (Amendment 1+2).
//    - CIL Accepted: future email_type -- will close job + alert Danielle.
//      Not in Phase A1 scope (we'll observe whether ServicePower routes
//      CIL events through this endpoint vs the AHS endpoint).
// 
//  Idempotency: job_email_event has UNIQUE on gmail_message_id. Endpoint
//  checks for existing event row FIRST; if found, returns "duplicate" no-op.
// 
//  Email type routing:
//    DISPATCH_OFFER, DISPATCH_OFFER_ACCEPTED -> create or update parent job
//    SCHEDULE_CHANGE                         -> update scheduled fields on parent
//    CANCELLATION                            -> update status on parent
//    NOTES_ADDED                             -> append to notes_internal on parent
//    STATUS_UPDATE, STATUS_REQUEST_REMINDER  -> logged only
//    DAILY_DIGEST                            -> logged only
//    UNKNOWN                                 -> logged only
// 
//  Approval ref: Phase A1 architecture proposal + Amendments 1 & 2.
query servicepower_email_intake verb=POST {
  api_group = "intake"

  input {
    text gmail_message_id
    text? gmail_thread_id?
    text? sender?
    text? subject?
    text email_type
    text? body_excerpt?
    text dispatches_json
    text? test_run_id?
    int? received_at_ms?
  }

  stack {
    precondition ($input.gmail_message_id != null && $input.gmail_message_id != "") {
      error_type = "inputerror"
      error = "gmail_message_id is required"
    }

    // Forward-only gate (2026-06-02). See ahs_email_intake for details.
    var $activation_ts {
      value = (($env.PARSER_ACTIVATION_TS_MS ?? "0")|to_int)
    }

    var $received_at {
      value = ($input.received_at_ms ?? 0)
    }

    conditional {
      if ($activation_ts > 0 && $received_at > 0 && $received_at < $activation_ts) {
        db.add event_log {
          data = {
            action  : "servicepower_email_intake_pre_activation"
            metadata: {
            gmail_message_id: $input.gmail_message_id
            activation_ts   : $activation_ts
            received_at_ms  : $received_at
            subject_preview : (($input.subject ?? "")|substr:0:120)
          }
          }
        } as $sp_pre_log

        return {
          value = {
            success         : true
            duplicate       : true
            reason          : "pre_activation"
            gmail_message_id: $input.gmail_message_id
            resolution      : "skipped — pre PARSER_ACTIVATION_TS_MS"
          }
        }
      }
    }

    var $dispatches {
      value = $input.dispatches_json|json_decode
    }
  
    db.get job_email_event {
      field_name = "gmail_message_id"
      field_value = $input.gmail_message_id
    } as $existing_event
  
    conditional {
      if ($existing_event != null) {
        return {
          value = ```
            {
              success         : true
              duplicate       : true
              gmail_message_id: $input.gmail_message_id
              actions         : [
                {
                  dispatch_index: 0
                  action        : "duplicate_ignored"
                  job_id        : ($existing_event.job_id ?? null)
                  resolution    : "gmail_message_id already in job_email_event"
                }
              ]
            }
            ```
        }
      }
    }
  
    var $actions_out {
      value = []
    }
  
    var $dispatch_index {
      value = 0
    }
  
    foreach ($dispatches) {
      each as $disp {
        var $action_label {
          value = "logged_only"
        }
      
        var $resolved_job_id {
          value = null
        }
      
        var $resolved_customer_id {
          value = null
        }
      
        var $resolution_note {
          value = ""
        }
      
        var $manual_review_flag {
          value = false
        }
      
        var $dedup_status {
          value = "OK"
        }
      
        var $is_logged_only {
          value = ($input.email_type == "STATUS_UPDATE") || ($input.email_type == "STATUS_REQUEST_REMINDER") || ($input.email_type == "DAILY_DIGEST") || ($input.email_type == "UNKNOWN")
        }
      
        var $is_update_only {
          value = ($input.email_type == "SCHEDULE_CHANGE") || ($input.email_type == "CANCELLATION") || ($input.email_type == "NOTES_ADDED")
        }
      
        var $is_create_or_update {
          value = ($input.email_type == "DISPATCH_OFFER") || ($input.email_type == "DISPATCH_OFFER_ACCEPTED")
        }
      
        var $call_number {
          value = ($disp.call_number ?? "")|trim
        }
      
        var $existing_job {
          value = null
        }
      
        conditional {
          if ($call_number != "") {
            db.query jobs {
              where = $db.jobs.claim_number == $call_number
              return = {type: "single"}
            } as $existing_job_lookup
          
            var.update $existing_job {
              value = $existing_job_lookup
            }
          }
        }
      
        conditional {
          if ($is_logged_only) {
            var.update $action_label {
              value = "logged_only"
            }
          
            conditional {
              if ($existing_job != null) {
                var.update $resolved_job_id {
                  value = $existing_job.id
                }
              
                var.update $resolution_note {
                  value = "logged-only email_type; matched parent job by claim_number=" ~ $call_number
                }
              }
            
              else {
                var.update $resolution_note {
                  value = "logged-only email_type; no parent job matched"
                }
              }
            }
          }
        }
      
        conditional {
          if ($is_update_only) {
            conditional {
              if ($existing_job == null) {
                var.update $action_label {
                  value = "logged_only"
                }
              
                var.update $resolution_note {
                  value = "update-only email_type but no parent job; logged only. Call#=" ~ $call_number
                }
              }
            
              else {
                var.update $resolved_job_id {
                  value = $existing_job.id
                }
              
                conditional {
                  if ($input.email_type == "SCHEDULE_CHANGE") {
                    var $sched_date {
                      value = ($disp.schedule_date ?? "")
                    }
                  
                    conditional {
                      if ($sched_date != "") {
                        // Date-only fields from ServicePower land at midnight UTC
                        // which is 7pm CT the prior day. Anchor to 08:00 CT
                        // (the standard arrival window start) so the calendar
                        // shows the job on the correct day.
                        var $sched_ts {
                          value = (($sched_date ~ " 08:00:00")|to_timestamp)|transform_timestamp:"+5 hours"
                        }
                      
                        db.edit jobs {
                          field_name = "id"
                          field_value = $existing_job.id
                          data = {
                            scheduled_start  : $sched_ts
                            scheduling_status: "scheduled"
                            scheduling_type  : "slot"
                            vendor_locked    : true
                            current_status   : "rescheduled"
                          }
                        } as $sched_update
                      
                        // Phase 5.5C: emit APPOINTMENT_SCHEDULED for SP-side reschedule.
                        var $as_sp_resched_obj {
                          value = {
                            job_id            : $existing_job.id
                            scheduled_start_ms: $sched_ts
                            scheduled_end_ms  : null
                            technician_id     : ($existing_job.technician_id ?? 0)
                            source            : "servicepower_reschedule"
                          }
                        }
                      
                        var $as_sp_resched_str {
                          value = $as_sp_resched_obj|json_encode
                        }
                      
                        db.add colony_signals {
                          data = {
                            signal_type    : "APPOINTMENT_SCHEDULED"
                            signal_strength: 60
                            source_colony  : ""
                            target_colonies: ""
                            payload        : $as_sp_resched_str
                          }
                        } as $as_sp_resched_signal
                      
                        db.add event_log {
                          data = {
                            action  : "appointment_scheduled_signal_emitted"
                            metadata: {
                            job_id            : $existing_job.id
                            signal_id         : $as_sp_resched_signal.id
                            scheduled_start_ms: $sched_ts
                            source            : "servicepower_reschedule"
                          }
                          }
                        } as $as_sp_resched_log
                      }
                    }
                  
                    var.update $action_label {
                      value = "updated_job_status"
                    }
                  
                    var.update $resolution_note {
                      value = "SCHEDULE_CHANGE applied to job_id=" ~ ($existing_job.id|to_text)
                    }
                  }
                }
              
                conditional {
                  if ($input.email_type == "CANCELLATION") {
                    db.edit jobs {
                      field_name = "id"
                      field_value = $existing_job.id
                      data = {
                        job_status       : "canceled"
                        scheduling_status: "canceled"
                        current_status   : "canceled"
                        friendly_status  : "Cancelled by warranty company"
                      }
                    } as $cancel_update
                  
                    var.update $action_label {
                      value = "updated_job_status"
                    }
                  
                    var.update $resolution_note {
                      value = "CANCELLATION applied to job_id=" ~ ($existing_job.id|to_text)
                    }
                  }
                }
              
                conditional {
                  if ($input.email_type == "NOTES_ADDED") {
                    var $existing_notes {
                      value = ($existing_job.notes_internal ?? "")
                    }
                  
                    var $appended_notes {
                      value = $existing_notes ~ "\n\n=== ServicePower note added " ~ (now|to_text) ~ " ===\n" ~ (($input.body_excerpt ?? "")|substr:0:1000)
                    }
                  
                    db.edit jobs {
                      field_name = "id"
                      field_value = $existing_job.id
                      data = {notes_internal: $appended_notes}
                    } as $notes_update
                  
                    var.update $action_label {
                      value = "appended_notes"
                    }
                  
                    var.update $resolution_note {
                      value = "NOTES_ADDED appended to job_id=" ~ ($existing_job.id|to_text)
                    }
                  }
                }
              }
            }
          }
        }
      
        conditional {
          if ($is_create_or_update) {
            conditional {
              if ($existing_job != null) {
                var.update $resolved_job_id {
                  value = $existing_job.id
                }
              
                db.edit jobs {
                  field_name = "id"
                  field_value = $existing_job.id
                  data = {current_status: ($disp.call_status ?? "Open")}
                } as $status_update
              
                var.update $action_label {
                  value = "updated_job_status"
                }
              
                var.update $resolution_note {
                  value = "DISPATCH_OFFER seen again for existing job_id=" ~ ($existing_job.id|to_text)
                }
              }
            
              else {
                var $phone10_final {
                  value = ($disp.customer.phone10 ?? null)
                }
              
                var $raw_street {
                  value = ($disp.customer.raw_street ?? "")
                }
              
                var $raw_city {
                  value = ($disp.customer.raw_city ?? "")
                }
              
                var $raw_state {
                  value = ($disp.customer.raw_state ?? "")
                }
              
                var $raw_zip {
                  value = ($disp.customer.raw_zip ?? "")
                }
              
                var $zip5 {
                  value = $raw_zip|substr:0:5
                }
              
                var $cust_phone_raw {
                  value = ($disp.customer.raw_phone ?? "")
                }
              
                var $dedup_signature {
                  value = ($disp.customer.dedup_signature ?? "")
                }
              
                var.update $dedup_status {
                  value = ($disp.customer.dedup_status ?? "FAILED")
                }
              
                conditional {
                  if ($dedup_status != "OK") {
                    var.update $manual_review_flag {
                      value = true
                    }
                  }
                }
              
                var $existing_customer {
                  value = null
                }
              
                var $related_customer_id {
                  value = null
                }
              
                conditional {
                  if ($dedup_signature != "") {
                    db.query customer {
                      where = $db.customer.dedup_signature == $dedup_signature
                      return = {type: "single"}
                    } as $sig_match
                  
                    var.update $existing_customer {
                      value = $sig_match
                    }
                  }
                }
              
                conditional {
                  if (($existing_customer == null) && ($phone10_final != null)) {
                    db.query customer {
                      where = $db.customer.phone == $phone10_final
                      return = {type: "single"}
                    } as $phone_match
                  
                    conditional {
                      if ($phone_match != null) {
                        var.update $related_customer_id {
                          value = $phone_match.id
                        }
                      }
                    }
                  }
                }
              
                var $customer_id_final {
                  value = 0
                }
              
                conditional {
                  if ($existing_customer != null) {
                    var.update $customer_id_final {
                      value = $existing_customer.id
                    }
                  }
                
                  else {
                    db.add customer {
                      data = {
                        first_name         : ($disp.customer.first_name ?? "")
                        last_name          : ($disp.customer.last_name ?? "")
                        phone              : ($phone10_final ?? "")
                        email              : ($disp.customer.email ?? "")
                        address            : $raw_street
                        city               : $raw_city
                        state              : $raw_state
                        zip                : $zip5
                        dedup_signature    : $dedup_signature
                        related_customer_id: $related_customer_id
                      }
                    } as $new_customer
                  
                    var.update $customer_id_final {
                      value = $new_customer.id
                    }
                  }
                }
              
                var $source_raw {
                  value = ($disp.source ?? "")|to_lower
                }
              
                var $warranty_company {
                  value = "ServicePower"
                }
              
                conditional {
                  if ($source_raw|contains:"square trade") {
                    var.update $warranty_company {
                      value = "SquareTrade"
                    }
                  }
                }
              
                var $sched_date_str {
                  value = ($disp.schedule_date ?? "")
                }
              
                // Date-only fields from ServicePower land at midnight UTC
                // which is 7pm CT the prior day. Anchor to 08:00 CT so the
                // calendar shows the job on the correct day.
                var $sched_ts {
                  value = ($sched_date_str != "") ? ((($sched_date_str ~ " 08:00:00")|to_timestamp)|transform_timestamp:"+5 hours") : null
                }
              
                var $install_date_str {
                  value = ($disp.install_date ?? "")
                }
              
                var $install_ts {
                  value = ($install_date_str != "") ? ($install_date_str|to_timestamp) : null
                }
              
                db.add jobs {
                  data = {
                    customer_id         : $customer_id_final
                    appliance_type      : ($disp.appliance_type ?? "")
                    brand               : ($disp.brand ?? "")
                    model_number        : ($disp.model ?? "")
                    serial_number       : ($disp.serial ?? "")
                    problem_summary     : (($disp.problem ?? "")|substr:0:200)
                    problem_description : ($disp.problem ?? "")
                    warranty_company    : $warranty_company
                    claim_number        : $call_number
                    service_address     : $raw_street
                    service_city        : $raw_city
                    service_state       : $raw_state
                    service_zip         : $zip5
                    scheduled_start     : $sched_ts
                    current_status      : ($disp.call_status ?? "Open")
                    friendly_status     : "New Intake (ServicePower)"
                    job_status          : "submitted"
                    triage_status       : "not_reviewed"
                    parts_status        : "not_needed"
                    scheduling_status   : ($sched_ts != null) ? "scheduled" : "not_ready"
                    scheduling_type     : ($sched_ts != null) ? "slot" : ""
                    vendor_locked       : ($sched_ts != null)
                    payment_status      : "warranty_pending"
                    source_type         : "servicepower_email"
                    source_agent        : "webhook"
                    intake_source       : "servicepower_email"
                    customer_type       : "warranty"
                    manual_review_needed: $manual_review_flag
                    notes_internal      : "=== SERVICEPOWER DISPATCH " ~ $call_number ~ " ===\nSource: " ~ ($disp.source ?? "") ~ "\nService Type: " ~ ($disp.service_type ?? "") ~ "\nCall Type: " ~ ($disp.call_type ?? "") ~ "\nSchedule Period: " ~ ($disp.schedule_period ?? "") ~ "\nContract #: " ~ ($disp.contract_number ?? "") ~ "\nAppointment URL: " ~ ($disp.appointment_form_url ?? "") ~ "\n\nProblem:\n" ~ ($disp.problem ?? "")
                    test_run_id         : ($input.test_run_id ?? "")
                  }
                } as $new_job
              
                var.update $resolved_job_id {
                  value = $new_job.id
                }
              
                var.update $resolved_customer_id {
                  value = $customer_id_final
                }
              
                db.add job_financial {
                  data = {
                    job_id        : $new_job.id
                    payment_status: "warranty_pending"
                  }
                } as $new_financial
              
                db.add job_event {
                  data = {
                    job_id      : $new_job.id
                    event_type  : "intake_created"
                    event_source: "servicepower_email"
                    event_notes : "ServicePower dispatch " ~ $call_number ~ " parsed and ingested"
                    created_by  : "system"
                  }
                } as $new_event
              
                // Phase B: emit JOB_CREATED for colony loop greeting (see docs/colony-loop-design.md section 16).
                var $jc_phone {
                  value = $phone10_final
                }
              
                var $jc_first {
                  value = ($disp.customer.first_name ?? "")
                }
              
                var $jc_appliance {
                  value = ($disp.appliance_type ?? "")
                }
              
                var $jc_payload_obj {
                  value = {
                    job_id             : $new_job.id
                    customer_phone     : $jc_phone
                    customer_first_name: $jc_first
                    appliance_type     : $jc_appliance
                    source             : "servicepower_email"
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
                    source   : "servicepower_email"
                  }
                  }
                } as $jc_log
              
                // Parallel ANT Phase 1 marker - Danielle's needs-scheduled.html
                // scans event_log for this action.
                db.add event_log {
                  data = {
                    action  : "parallel_job_created_from_email"
                    metadata: {
                    job_id          : $new_job.id
                    customer_id     : $customer_id_final
                    intake_source   : "email_servicepower"
                    warranty_company: $warranty_company
                    claim_number    : $call_number
                  }
                  }
                } as $parallel_marker_sp
              
                // SMS Danielle on every new SP job (internal recipient)
                var $dn_sp_city {
                  value = ($raw_city ?? "")
                }
              
                var $dn_sp_body {
                  value = ("[ant] new ServicePower job in Needs Scheduled: " ~ ($customer_id_final|to_text) ~ ", " ~ $dn_sp_city ~ ". tnapplianceexchange.net/needs-scheduled.html")
                }
              
                api.request {
                  url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
                  method = "POST"
                  params = {
                    to         : "+16154850713"
                    message    : $dn_sp_body
                    context_tag: "parallel_sp_danielle_alert"
                  }
                
                  headers = []
                    |push:"Content-Type: application/json"
                } as $danielle_sp_alert
              
                // Phase 5.5C: emit APPOINTMENT_SCHEDULED when SP intake lands
                // a brand-new job with a real scheduled_start (gated to skip
                // null/zero times from emails without "Schedule Date" set).
                var $as_sp_create_start {
                  value = ($sched_ts ?? 0)
                }
              
                conditional {
                  if ($as_sp_create_start > 0) {
                    var $as_sp_create_obj {
                      value = ```
                        {
                          job_id            : $new_job.id
                          scheduled_start_ms: $as_sp_create_start
                          scheduled_end_ms  : null
                          technician_id     : 0
                          source            : "servicepower_email"
                        }
                        ```
                    }
                  
                    var $as_sp_create_str {
                      value = $as_sp_create_obj|json_encode
                    }
                  
                    db.add colony_signals {
                      data = {
                        signal_type    : "APPOINTMENT_SCHEDULED"
                        signal_strength: 60
                        source_colony  : ""
                        target_colonies: ""
                        payload        : $as_sp_create_str
                      }
                    } as $as_sp_create_signal
                  
                    db.add event_log {
                      data = {
                        action  : "appointment_scheduled_signal_emitted"
                        metadata: {
                        job_id            : $new_job.id
                        signal_id         : $as_sp_create_signal.id
                        scheduled_start_ms: $as_sp_create_start
                        source            : "servicepower_email"
                      }
                      }
                    } as $as_sp_create_log
                  }
                }
              
                var.update $action_label {
                  value = "created_job"
                }
              
                var.update $resolution_note {
                  value = "Created new job_id=" ~ ($new_job.id|to_text) ~ " (Call#=" ~ $call_number ~ ", dedup_status=" ~ $dedup_status ~ ")"
                }
              
                conditional {
                  if ($dedup_status == "FAILED") {
                    var $alert_subject {
                      value = "[TN Appliance] Manual customer dedup needed - Job #" ~ ($new_job.id|to_text)
                    }
                  
                    var $alert_body {
                      value = "Hi Danielle,\n\nA new warranty job came in but the system couldn't automatically match the customer to an existing record.\n\nJob ID: " ~ ($new_job.id|to_text) ~ "\nCall #: " ~ $call_number ~ "\nSource: " ~ ($disp.source ?? "") ~ "\nCustomer name: " ~ ($disp.customer.full_name ?? "(not provided)") ~ "\nPhone: " ~ ((($cust_phone_raw != "") ? $cust_phone_raw : "NOT PROVIDED")) ~ "\nAddress: " ~ (($raw_street != "") ? ($raw_street ~ ", " ~ $raw_city ~ ", " ~ $raw_state ~ " " ~ $zip5) : "NOT PROVIDED") ~ "\n\nPlease review and merge with the correct customer record.\n\n-TN Appliance Exchange automation"
                    }
                  
                    api.request {
                      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:SXH92Wk7/send_email"
                      method = "POST"
                      params = {
                        to     : "danielle.tnappliance@gmail.com"
                        subject: $alert_subject
                        body   : $alert_body
                      }
                    
                      headers = ["Content-Type: application/json"]
                      timeout = 30
                    } as $email_resp
                  }
                }
              }
            }
          }
        }
      
        var $event_msg_id {
          value = ($dispatch_index == 0) ? $input.gmail_message_id : ($input.gmail_message_id ~ "#" ~ ($dispatch_index|to_text))
        }
      
        db.add job_email_event {
          data = {
            job_id          : $resolved_job_id
            email_type      : $input.email_type
            vendor          : "servicepower"
            gmail_message_id: $event_msg_id
            gmail_thread_id : ($input.gmail_thread_id ?? "")
            sender          : ($input.sender ?? "")
            subject         : ($input.subject ?? "")
            body_excerpt    : ($input.body_excerpt ?? "")|substr:0:500
            triggered_action: $action_label
            resolution_note : $resolution_note
            metadata        : {
            dispatch_index : $dispatch_index
            call_number    : $call_number
            dedup_status   : $dedup_status
            customer_id    : $resolved_customer_id
            source         : ($disp.source ?? "")
            section_header : ($disp.section_header ?? "")
            schedule_date  : ($disp.schedule_date ?? "")
            schedule_period: ($disp.schedule_period ?? "")
            brand          : ($disp.brand ?? "")
            appliance_type : ($disp.appliance_type ?? "")
            repeat_call    : ($disp.repeat_call ?? false)
            appointment_url: ($disp.appointment_form_url ?? "")
          }
          }
        } as $event_log_row
      
        var $action_result {
          value = {
            dispatch_index        : $dispatch_index
            action                : $action_label
            job_id                : $resolved_job_id
            customer_id           : $resolved_customer_id
            related_to_customer_id: $related_customer_id
            dedup_status          : $dedup_status
            resolution_note       : $resolution_note
          }
        }
      
        var.update $actions_out {
          value = $actions_out|push:$action_result
        }
      
        var.update $dispatch_index {
          value = $dispatch_index + 1
        }
      }
    }
  }

  response = {
    success         : true
    duplicate       : false
    gmail_message_id: $input.gmail_message_id
    dispatch_count  : $dispatches|count
    actions         : $actions_out
  }

  guid = "servicepower-email-intake-2026-05-12"
}