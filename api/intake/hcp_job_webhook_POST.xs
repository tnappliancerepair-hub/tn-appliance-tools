query hcp_job_webhook verb=POST {
  api_group = "intake"

  input {
    text? event?
    text? id?
    text? created_at?
    json? data?
    text? foo?
    text? _internal_auth?
  }

  stack {
    //  ── Internal auth check (Netlify gateway proof) ──
    //  Requests must come through the Netlify proxy at
    //  /.netlify/functions/hcp-webhook-proxy, which performs HMAC-SHA256
    //  verification on the raw HCP body and injects $input._internal_auth as
    //  a body field. We can't reliably read HTTP headers in XanoScript
    //  text-mode today (no precedent in workspace, no public docs), so this
    //  body-field check is the practical equivalent.
    // 
    //  Transition guard: if $env.HCP_INTERNAL_AUTH_SECRET is unset or empty,
    //  we SKIP this check. That keeps the endpoint working during the deploy
    //  window between (a) Netlify going live and (b) the Xano env var being
    //  set. Once the env var is set, the precondition activates and direct-
    //  to-Xano POSTs (bypassing Netlify) get rejected.
    var $expected_internal_auth {
      value = ($env.HCP_INTERNAL_AUTH_SECRET ?? "")|trim
    }
  
    var $received_internal_auth {
      value = ($input._internal_auth ?? "")|trim
    }
  
    conditional {
      if (($expected_internal_auth != "") && ($received_internal_auth != $expected_internal_auth)) {
        db.add event_log {
          data = {
            action  : "hcp_internal_auth_failed"
            metadata: {
            note                   : "request did not include matching _internal_auth - direct POST or stale Netlify"
            has_internal_auth_input: ($received_internal_auth != "")
          }
          }
        } as $auth_fail_log
      
        return {
          value = {success: false, error: "unauthorized"}
        }
      }
    }
  
    // ── HCP test-ping detection ──
    // HCP fires a test payload {"foo":"bar"} when the operator clicks "Test
    // webhook" or saves a new webhook config. Real events have $input.event
    // populated, so checking event==null avoids false positives. Sits at the
    // top of the stack so test pings short-circuit before any real-event
    // logging or processing.
    conditional {
      if (($input.foo == "bar") && ($input.event == null)) {
        db.add event_log {
          data = {
            action  : "hcp_webhook_test_ping_received"
            metadata: {note: "HCP test ping with {foo:bar} - input shape OK"}
          }
        } as $test_ping_log
      
        return {
          value = {
            success: true
            message: "test webhook received - ready to receive real events"
          }
        }
      }
    }
  
    // PARALLEL ANT PHASE 1 KILL SWITCH (5/27/26).
    // When env.HCP_WEBHOOK_DISABLED=true, log + ack-200 + return. NO row
    // creation, NO operational triggers. HCP runs entirely on its own;
    // the new system does not record HCP intake at all. Operator flips
    // this flag in Xano env vars when Phase 1 launches. Default: not set
    // → webhook continues to work (rollback safety).
    conditional {
      if (($env.HCP_WEBHOOK_DISABLED ? "") == "true") {
        db.add event_log {
          data = {
            action  : "hcp_webhook_disabled_noop"
            metadata: {
            event_type: ($input.event ?? "")
            hcp_id    : ($input.id ?? "")
            reason    : "HCP_WEBHOOK_DISABLED=true — parallel ANT Phase 1"
          }
          }
        } as $disabled_noop_log
      
        return {
          value = {
            success : true
            disabled: true
            message : "hcp_webhook_disabled"
          }
        }
      }
    }
  
    // PHASE 1c diagnostic - REMOVE AFTER FIRST REAL HCP DELIVERY VERIFIED.
    // Check event_log for action='hcp_webhook_raw_input_capture' to see actual
    // data shape, then update $body reconstruction accordingly.
    db.add event_log {
      data = {
        action  : "hcp_webhook_raw_input_capture"
        metadata: {
        input_event     : $input.event
        input_id        : $input.id
        input_created_at: $input.created_at
        input_data_raw  : $input.data
        input_foo       : $input.foo
      }
      }
    } as $raw_capture_log
  
    // ── Reconstruct $body to match the legacy handler's expected shape ──
    // HCP sends bare top-level keys {event, id, created_at, data}. The
    // existing handler downstream reads $body.event, $body.job, $body.appointment.
    // We build $body = (data || {}) | set:event so downstream code keeps
    // working assuming HCP data shape D1 (data: {job, appointment, customer}).
    // If first real delivery shows D2 (data IS the entity), revisit using
    // raw_input_capture log.
    var $body {
      value = `($input.data ?? {})|set:"event":($input.event ?? "")`
    }
  
    conditional {
      if ($body == null) {
        db.add event_log {
          data = {
            action  : "hcp_webhook_no_body"
            metadata: {note: "input.body was null"}
          }
        } as $log_no_body
      
        return {
          value = {success: true}
        }
      }
    }
  
    db.add event_log {
      data = {
        action  : "hcp_webhook_received"
        metadata: {raw_payload: $body}
      }
    } as $log_entry
  
    var $event_type {
      value = $body.event
    }
  
    conditional {
      if (($event_type == "customer.created") || ($event_type == "customer.updated") || ($event_type == "customer.deleted")) {
        db.add event_log {
          data = {
            action  : "hcp_customer_event_ignored"
            metadata: {event_type: $event_type}
          }
        } as $log_cust_ignored
      
        return {
          value = {status: "success", message: "Customer event ignored"}
        }
      }
    }
  
    // Lightweight ack-and-log for HCP events we recognize but don't act on
    // yet. Returns 200 so HCP delivery log shows green; useful for audit
    // visibility (we'll see when jobs get canceled, deleted, on_my_way, etc).
    conditional {
      if (($event_type == "job.created") || ($event_type == "job.updated") || ($event_type == "job.canceled") || ($event_type == "job.deleted") || ($event_type == "job.on_my_way") || ($event_type == "job.appointment.appointment_discarded") || ($event_type == "job.appointment.appointment_pros_assigned") || ($event_type == "job.appointment.appointment_pros_unassigned")) {
        db.add event_log {
          data = {
            action  : "hcp_event_acknowledged"
            metadata: {event_type: $event_type}
          }
        } as $log_ack
      
        return {
          value = {status: "success", message: "Event acknowledged"}
        }
      }
    }
  
    var $job_data {
      value = ($body.job ?? null)
    }
  
    conditional {
      if ($job_data == null) {
        db.add event_log {
          data = {
            action  : "hcp_event_no_job"
            metadata: {event_type: $event_type}
          }
        } as $log_no_job
      
        return {
          value = {
            status : "success"
            message: "Event has no job object"
          }
        }
      }
    }
  
    var $hcp_job_id {
      value = $job_data.id
    }
  
    db.add event_log {
      data = {
        action  : "hcp_webhook_parsed"
        metadata: {event_type: $event_type, hcp_job_id: $hcp_job_id}
      }
    } as $parsed_log
  
    conditional {
      if (($event_type == "job.appointment.scheduled") || ($event_type == "job.scheduled") || ($event_type == "job.appointment.rescheduled")) {
        db.query jobs {
          where = $db.jobs.housecall_pro_job_id == $hcp_job_id
          return = {type: "single"}
        } as $job_appt
      
        conditional {
          if ($job_appt == null) {
            db.add event_log {
              data = {
                action  : "hcp_appt_no_matching_job_creating"
                metadata: {hcp_job_id: $hcp_job_id, event_type: $event_type}
              }
            } as $log_creating
          
            var $hcp_customer {
              value = ($job_data.customer ?? null)
            }
          
            var $cust_first {
              value = ($hcp_customer.first_name ?? "")
            }
          
            var $cust_last {
              value = ($hcp_customer.last_name ?? "")
            }
          
            var $cust_phone {
              value = ($hcp_customer.mobile_number ?? "")
            }
          
            var $cust_email {
              value = ($hcp_customer.email ?? "")
            }
          
            var $hcp_addr {
              value = ($job_data.address ?? null)
            }
          
            var $svc_street {
              value = ($hcp_addr.street ?? "")
            }
          
            var $svc_city {
              value = ($hcp_addr.city ?? "")
            }
          
            var $svc_state {
              value = ($hcp_addr.state ?? "")
            }
          
            var $svc_zip {
              value = ($hcp_addr.zip ?? "")
            }
          
            var $resolved_customer_id {
              value = 0
            }
          
            var $existing_customer {
              value = null
            }
          
            conditional {
              if (($cust_phone != null) && ($cust_phone != "")) {
                db.query customer {
                  where = $db.customer.phone == $cust_phone
                  return = {type: "single"}
                } as $existing_customer
              }
            }
          
            conditional {
              if ($existing_customer != null) {
                var.update $resolved_customer_id {
                  value = $existing_customer.id
                }
              
                db.add event_log {
                  data = {
                    action  : "hcp_customer_matched_by_phone"
                    metadata: {customer_id: $existing_customer.id, phone: $cust_phone}
                  }
                } as $log_cust_matched
              }
            
              else {
                db.add customer {
                  data = {
                    first_name: $cust_first
                    last_name : $cust_last
                    phone     : $cust_phone
                    email     : $cust_email
                    address   : $svc_street
                    city      : $svc_city
                    state     : $svc_state
                    zip       : $svc_zip
                  }
                } as $new_customer
              
                var.update $resolved_customer_id {
                  value = $new_customer.id
                }
              
                db.add event_log {
                  data = {
                    action  : "hcp_customer_created"
                    metadata: {customer_id: $new_customer.id, phone: $cust_phone}
                  }
                } as $log_cust_created
              }
            }
          
            var $hcp_assigned_pro_id {
              value = ""
            }
          
            var $assigned_emps {
              value = ($job_data.assigned_employees ?? [])
            }
          
            conditional {
              if (($assigned_emps|count) > 0) {
                var $first_assigned {
                  value = $assigned_emps|first
                }
              
                var.update $hcp_assigned_pro_id {
                  value = $first_assigned.id
                }
              }
            }
          
            var $job_tags {
              value = ($job_data.tags ?? [])
            }
          
            var $derived_appliance {
              value = null
            }
          
            foreach ($job_tags) {
              each as $tag {
                var $tag_lower {
                  value = $tag|to_lower
                }
              
                conditional {
                  if (($tag_lower == "fridge") || ($tag_lower == "refrigerator")) {
                    var.update $derived_appliance {
                      value = "refrigerator"
                    }
                  }
                }
              
                conditional {
                  if ($tag_lower == "washer") {
                    var.update $derived_appliance {
                      value = "washer"
                    }
                  }
                }
              
                conditional {
                  if ($tag_lower == "dryer") {
                    var.update $derived_appliance {
                      value = "dryer"
                    }
                  }
                }
              
                conditional {
                  if ($tag_lower == "dishwasher") {
                    var.update $derived_appliance {
                      value = "dishwasher"
                    }
                  }
                }
              
                conditional {
                  if (($tag_lower == "oven") || ($tag_lower == "range") || ($tag_lower == "stove")) {
                    var.update $derived_appliance {
                      value = "range"
                    }
                  }
                }
              
                conditional {
                  if ($tag_lower == "microwave") {
                    var.update $derived_appliance {
                      value = "microwave"
                    }
                  }
                }
              }
            }
          
            var $job_notes {
              value = ($job_data.notes ?? "")
            }
          
            // Map HCP pro ID to Xano tech_id via technicians.hcp_id lookup
            // (mirrors UPDATE path at lines 516-536). Defaults to Teddy (1)
            // if no assigned pro on creation or no matching tech found.
            var $resolved_tech_id {
              value = 1
            }
          
            conditional {
              if ($hcp_assigned_pro_id != "") {
                db.query technicians {
                  where = $db.technicians.hcp_id == $hcp_assigned_pro_id && $db.technicians.active == true
                  return = {type: "single"}
                } as $tech_create
              
                conditional {
                  if ($tech_create != null) {
                    var.update $resolved_tech_id {
                      value = $tech_create.id
                    }
                  }
                
                  else {
                    db.add event_log {
                      data = {
                        action  : "create_tech_not_found"
                        metadata: {
                        hcp_pro_id: $hcp_assigned_pro_id
                        hcp_job_id: $hcp_job_id
                      }
                      }
                    } as $log_no_tech_create
                  }
                }
              }
            }
          
            db.add jobs {
              data = {
                customer_id           : $resolved_customer_id
                housecall_pro_job_id  : $hcp_job_id
                hcp_assigned_to       : $hcp_assigned_pro_id
                technician_id         : $resolved_tech_id
                scheduling_status     : "prediagnosis_pending"
                pre_diagnosis_complete: false
                intake_source         : "hcp_webhook"
                customer_type         : "warranty"
                appliance_type        : $derived_appliance
                service_address       : $svc_street
                service_city          : $svc_city
                service_state         : $svc_state
                service_zip           : $svc_zip
                notes_internal        : $job_notes
                current_status        : "new"
                job_status            : "new"
                job_time              : "standard"
              }
            } as $new_job
          
            db.add event_log {
              data = {
                action  : "hcp_job_created_from_webhook"
                metadata: {
                job_id         : $new_job.id
                hcp_job_id     : $hcp_job_id
                customer_id    : $resolved_customer_id
                appliance_type : $derived_appliance
                hcp_assigned_to: $hcp_assigned_pro_id
              }
              }
            } as $log_job_created
          
            // Phase B: emit JOB_CREATED for colony loop greeting (see docs/colony-loop-design.md section 16).
            var $jc_phone {
              value = $cust_phone
            }
          
            var $jc_first {
              value = $cust_first
            }
          
            var $jc_appliance {
              value = ($derived_appliance ?? "")
            }
          
            var $jc_payload_obj {
              value = {
                job_id             : $new_job.id
                customer_phone     : $jc_phone
                customer_first_name: $jc_first
                appliance_type     : $jc_appliance
                source             : "hcp_webhook"
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
                source   : "hcp_webhook"
              }
              }
            } as $jc_log
          
            // Phase 5.5A.1: emit TECH_ASSIGNED so the loop SMSes the assigned tech.
            var $ta_payload_obj {
              value = {
                job_id             : $new_job.id
                technician_id      : $resolved_tech_id
                prior_technician_id: null
                source             : "hcp_appointment_scheduled"
                assigned_at_ms     : now|to_ms
              }
            }
          
            var $ta_payload_str {
              value = $ta_payload_obj|json_encode
            }
          
            db.add colony_signals {
              data = {
                signal_type    : "TECH_ASSIGNED"
                signal_strength: 70
                source_colony  : ""
                target_colonies: ""
                payload        : $ta_payload_str
              }
            } as $ta_signal
          
            db.add event_log {
              data = {
                action  : "tech_assigned_signal_emitted"
                metadata: {
                job_id       : $new_job.id
                signal_id    : $ta_signal.id
                technician_id: $resolved_tech_id
                source       : "hcp_appointment_scheduled"
              }
              }
            } as $ta_log
          
            var.update $job_appt {
              value = $new_job
            }
          }
        }
      
        var $appt {
          value = ($body.appointment ?? null)
        }
      
        var $sched_start_raw {
          value = ($appt.start_time ?? null)
        }
      
        var $sched_end_raw {
          value = ($appt.end_time ?? null)
        }
      
        var $start_ts {
          value = ($sched_start_raw == null) ? null : ($sched_start_raw|to_timestamp)
        }
      
        var $end_ts {
          value = null
        }
      
        conditional {
          if ($sched_end_raw != null) {
            var.update $end_ts {
              value = $sched_end_raw|to_timestamp
            }
          }
        
          else {
            conditional {
              if ($start_ts != null) {
                var.update $end_ts {
                  value = $start_ts|transform_timestamp:"+3 hours"
                }
              }
            }
          }
        }
      
        conditional {
          if ($start_ts == null) {
            db.add event_log {
              data = {
                action  : "hcp_appt_no_start_time"
                metadata: {hcp_job_id: $hcp_job_id, raw_appt: $appt}
              }
            } as $log_no_start
          
            return {
              value = {
                status : "success"
                message: "Appointment had no start time"
              }
            }
          }
        }
      
        var $appt_employees {
          value = ($appt.dispatched_employees ?? ($job_data.assigned_employees ?? []))
        }
      
        var $resolved_tech_id {
          value = $job_appt.technician_id
        }
      
        var $hcp_pro_id_now {
          value = ""
        }
      
        conditional {
          if (($appt_employees|count) > 0) {
            var $first_emp {
              value = $appt_employees|first
            }
          
            var $first_emp_hcp_id {
              value = $first_emp.id
            }
          
            var.update $hcp_pro_id_now {
              value = $first_emp_hcp_id
            }
          
            db.query technicians {
              where = $db.technicians.hcp_id == $first_emp_hcp_id && $db.technicians.active == true
              return = {type: "single"}
            } as $tech_appt
          
            conditional {
              if ($tech_appt != null) {
                var.update $resolved_tech_id {
                  value = $tech_appt.id
                }
              }
            
              else {
                db.add event_log {
                  data = {
                    action  : "appt_tech_not_found"
                    metadata: {hcp_id: $first_emp_hcp_id, hcp_job_id: $hcp_job_id}
                  }
                } as $log_no_tech
              }
            }
          }
        }
      
        var $derived_window {
          value = ""
        }
      
        conditional {
          if ($start_ts != null) {
            var $start_hour {
              value = ($start_ts|format_timestamp:"H")|to_int
            }
          
            conditional {
              if (($start_hour >= 8) && ($start_hour < 11)) {
                var.update $derived_window {
                  value = "8-11"
                }
              }
            
              elseif (($start_hour >= 11) && ($start_hour < 14)) {
                var.update $derived_window {
                  value = "11-2"
                }
              }
            
              elseif (($start_hour >= 14) && ($start_hour < 17)) {
                var.update $derived_window {
                  value = "2-5"
                }
              }
            
              else {
                var.update $derived_window {
                  value = "off-hours"
                }
              }
            }
          }
        }
      
        // Side fields (scheduled_end, hcp_assigned_to, service_eta_window)
        // direct-write — not part of state machine's concern.
        db.edit jobs {
          field_name = "id"
          field_value = $job_appt.id
          data = {
            scheduled_end     : $end_ts
            hcp_assigned_to   : $hcp_pro_id_now
            service_eta_window: $derived_window
          }
        } as $updated_job

        // Delegate the state transition (scheduling_status + scheduled_start
        // + technician_id) to the state machine.
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/transition_job_state"
          method = "POST"
          params = {
            job_id            : $job_appt.id
            target_state      : "scheduled"
            actor             : "vendor"
            reason            : "hcp webhook appointment.scheduled"
            technician_id     : $resolved_tech_id
            scheduled_start_ms: $start_ts
          }
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $hcp_sched_transition
      
        // Phase 5.5C: emit APPOINTMENT_SCHEDULED for customer + tech confirmation SMS.
        var $as_payload_obj {
          value = {
            job_id            : $job_appt.id
            scheduled_start_ms: $start_ts
            scheduled_end_ms  : $end_ts
            technician_id     : $resolved_tech_id
            source            : "hcp_webhook"
          }
        }
      
        var $as_payload_str {
          value = $as_payload_obj|json_encode
        }
      
        db.add colony_signals {
          data = {
            signal_type    : "APPOINTMENT_SCHEDULED"
            signal_strength: 60
            source_colony  : ""
            target_colonies: ""
            payload        : $as_payload_str
          }
        } as $as_signal
      
        db.add event_log {
          data = {
            action  : "appointment_scheduled_signal_emitted"
            metadata: {
            job_id            : $job_appt.id
            signal_id         : $as_signal.id
            scheduled_start_ms: $start_ts
            source            : "hcp_webhook"
          }
          }
        } as $as_log
      
        db.add event_log {
          data = {
            action  : "job_scheduled"
            metadata: {
            job_id         : $job_appt.id
            event_type     : $event_type
            technician_id  : $resolved_tech_id
            hcp_assigned_to: $hcp_pro_id_now
          }
          }
        } as $log_scheduled
      
        return {
          value = {status: "success", message: "Job scheduled"}
        }
      }
    }
  
    // $work_status declaration removed: HCP fires job.started / job.completed
    // as distinct events, no work_status sub-field. We route on $event_type
    // alone now. Strict-field-access on a missing key would throw.
    var $assigned_employees {
      value = $job_data.assigned_employees ?? []
    }
  
    // HCP fires job.started and job.completed as separate events (not as
    // sub-statuses of a single job.work_status_changed event). The original
    // handler was written against incorrect event names. Anything that is NOT
    // one of these two falls through here as unhandled.
    conditional {
      if (($event_type != "job.started") && ($event_type != "job.completed")) {
        db.add event_log {
          data = {
            action  : "hcp_event_unhandled"
            metadata: {event_type: $event_type, hcp_job_id: $hcp_job_id}
          }
        } as $log_unhandled
      
        return {
          value = {status: "success", message: "Event ignored"}
        }
      }
    }
  
    db.query jobs {
      where = $db.jobs.housecall_pro_job_id == $hcp_job_id
      return = {type: "single"}
    } as $job
  
    conditional {
      if ($job == null) {
        db.add event_log {
          data = {
            action  : "hcp_webhook_no_matching_job"
            metadata: {hcp_job_id: $hcp_job_id}
          }
        } as $job_log
      
        return {
          value = {status: "success", message: "No matching job found"}
        }
      }
    }
  
    var $sms_type {
      value = null
    }
  
    // HCP fires job.started and job.completed as distinct events. We only
    // reach here for one of those two (filtered above), so route on event_type
    // directly. The legacy work_status sub-field branch is gone.
    conditional {
      if ($event_type == "job.started") {
        var.update $sms_type {
          value = "tech_arrival"
        }
      }
    
      else {
        var.update $sms_type {
          value = "tech_completion"
        }
      
        db.get customer {
          field_name = "id"
          field_value = $job.customer_id
        } as $customer
      
        conditional {
          if ($customer != null) {
            var $customer_phone {
              value = $customer.phone
            }
          
            var $customer_first_name {
              value = $customer.first_name ?? "Customer"
            }
          
            var $now_hour {
              value = now|format_timestamp:"H"|to_int
            }
          
            var $send_at {
              value = null
            }
          
            conditional {
              if (($now_hour >= 21) || ($now_hour < 8)) {
                var $target_date {
                  value = `($now_hour >= 21) ? now|transform_timestamp:"+1 day" : now`
                }
              
                var.update $send_at {
                  value = ($target_date|format_timestamp:"Y-m-d 08:00:00")|to_timestamp
                }
              }
            
              else {
                var.update $send_at {
                  value = now|transform_timestamp:"+2 hours"
                }
              }
            }
          
            db.add feedback_queue {
              data = {
                job_id             : $job.id
                customer_phone     : $customer_phone
                customer_first_name: $customer_first_name
                send_at            : $send_at
              }
            }
          
            db.add event_log {
              data = {
                action  : "feedback_queued"
                metadata: {job_id: $job.id, send_at: $send_at}
              }
            }
          }
        }
      
        // Delegate to state machine. HCP webhook acts on behalf of the
        // tech in the field. The state machine validates the transition
        // and writes the audit row.
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/transition_job_state"
          method = "POST"
          params = {
            job_id      : $job.id
            target_state: "completed"
            actor       : "vendor"
            reason      : "hcp webhook job.completed"
          }
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $hcp_complete_transition

        // Phase 5A: emit JOB_COMPLETED for warranty-submission agent (warranty jobs only).
        var $jcc_is_warranty {
          value = (($job.customer_type ?? "") == "warranty")
        }
      
        conditional {
          if ($jcc_is_warranty) {
            var $jcc_warranty_company {
              value = ($job.warranty_company ?? "")
            }
          
            var $jcc_claim_number {
              value = ($job.claim_number ?? "")
            }
          
            var $jcc_completed_at_ms {
              value = now|to_ms
            }
          
            var $jcc_payload_obj {
              value = {
                job_id          : $job.id
                source          : "hcp_webhook_completed"
                warranty_company: $jcc_warranty_company
                claim_number    : $jcc_claim_number
                completed_at_ms : $jcc_completed_at_ms
              }
            }
          
            var $jcc_payload_str {
              value = $jcc_payload_obj|json_encode
            }
          
            db.add colony_signals {
              data = {
                signal_type    : "JOB_COMPLETED"
                signal_strength: 60
                source_colony  : ""
                target_colonies: ""
                payload        : $jcc_payload_str
              }
            } as $jcc_signal
          
            db.add event_log {
              data = {
                action  : "job_completed_signal_emitted"
                metadata: {
                job_id          : $job.id
                signal_id       : $jcc_signal.id
                source          : "hcp_webhook_completed"
                warranty_company: $jcc_warranty_company
              }
              }
            } as $jcc_log
          }
        }
      }
    }
  
    db.get customer {
      field_name = "id"
      field_value = $job.customer_id
    } as $customer_orig
  
    var $customer_first_name_orig {
      value = $customer_orig.first_name ?? "Customer"
    }
  
    foreach ($assigned_employees) {
      each as $employee {
        var $employee_hcp_id {
          value = $employee.id
        }
      
        db.query technicians {
          where = $db.technicians.hcp_id == $employee_hcp_id && $db.technicians.active == true
          return = {type: "single"}
        } as $tech
      
        conditional {
          if ($tech == null) {
            db.add event_log {
              data = {
                action  : "tech_not_found_in_db"
                metadata: {hcp_id: $employee_hcp_id, job_id: $job.id}
              }
            } as $tech_log
          }
        
          else {
            var $sms_body {
              value = ""
            }
          
            conditional {
              if ($sms_type == "tech_arrival") {
                var.update $sms_body {
                  value = "Job #" ~ ($job.id|to_text) ~ " - " ~ $customer_first_name_orig ~ "\n" ~ ($job.appliance_type ?? "Unknown") ~ " - '" ~ ($job.problem_summary ?? "No summary") ~ "'\nTech Ant is ready to walk you through the TDR:\nhttps://tnapplianceexchange.net/tech-ant.html?job_id=" ~ ($job.id|to_text) ~ "&tech_id=" ~ ($tech.id|to_text)
                }
              }
            
              else {
                var.update $sms_body {
                  value = "Job #" ~ ($job.id|to_text) ~ " - Wrap up\nTech Ant needs final photos and TDR completion:\nhttps://tnapplianceexchange.net/tech-ant.html?job_id=" ~ ($job.id|to_text) ~ "&tech_id=" ~ ($tech.id|to_text)
                }
              }
            }
          
            // ── SMS_ENABLED gate (call_site: hcp_job_webhook_POST.xs:791) ──
            var $gate791_recipient_e164 {
              value = ($tech.phone ?? "")|trim
            }
          
            var $gate791_recipient_bare {
              value = $gate791_recipient_e164|replace:"+1":""
            }
          
            var $gate791_is_owner {
              value = ($gate791_recipient_e164 == "+16154855795") || ($gate791_recipient_bare == "6154855795")
            }
          
            var $gate791_sms_enabled {
              value = (($env.SMS_ENABLED ?? "false") == "true")
            }
          
            var $gate791_should_send {
              value = $gate791_sms_enabled || $gate791_is_owner
            }
          
            conditional {
              if ($gate791_should_send == false) {
                db.add event_log {
                  data = {
                    action  : "sms_gated"
                    metadata: {
                    recipient   : $gate791_recipient_e164
                    body_preview: $sms_body|substr:0:200
                    gated_reason: "SMS_ENABLED=false, non-owner recipient"
                    call_site   : "hcp_job_webhook_POST.xs:791"
                    tech_id     : $tech.id
                    job_id      : $job.id
                    sms_type    : $sms_type
                  }
                  }
                } as $gate791_log
              }
            
              else {
                conditional {
                  if ($gate791_is_owner && $gate791_sms_enabled == false) {
                    db.add event_log {
                      data = {
                        action  : "sms_owner_bypass"
                        metadata: {
                        recipient   : $gate791_recipient_e164
                        body_preview: $sms_body|substr:0:200
                        call_site   : "hcp_job_webhook_POST.xs:791"
                        tech_id     : $tech.id
                        job_id      : $job.id
                        sms_type    : $sms_type
                      }
                      }
                    } as $bypass791_log
                  }
                }
              
                api.request {
                  url = "https://api.telnyx.com/v2/messages"
                  method = "POST"
                  params = {
                    from: $env.TELNYX_FROM_CUSTOMER
                    to  : $tech.phone
                    text: $sms_body
                  }
                
                  headers = [
                    "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                    "Content-Type: application/json"
                  ]
                } as $twilio_response
              
                var $action_name {
                  value = "tech_sms_failed"
                }
              
                conditional {
                  if (($twilio_response.response.status == 201) || ($twilio_response.response.status == 200)) {
                    var.update $action_name {
                      value = "tech_sms_sent"
                    }
                  }
                }
              
                db.add event_log {
                  data = {
                    action  : $action_name
                    metadata: {
                    tech_id : $tech.id
                    job_id  : $job.id
                    sms_type: $sms_type
                  }
                  }
                } as $sms_log
              }
            }
          
            // Phase 1b: bootstrap Tech Ant Assist live session on tech_arrival.
            // Gated on $env.TECH_ASSIST_ENABLED so we control rollout. Additive -
            // does NOT replace the tech_arrival SMS above; runs alongside during
            // cutover. See docs/ant-tech-assist-design-v1.md.
            conditional {
              if (($sms_type == "tech_arrival") && ($env.TECH_ASSIST_ENABLED == "true")) {
                api.request {
                  url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/start_tech_assist_session"
                  method = "POST"
                  params = {
                    job_id             : $job.id
                    technician_id      : $tech.id
                    session_start_event: "hcp_in_progress"
                  }
                
                  headers = ["Content-Type: application/json"]
                } as $assist_session_resp
              
                db.add event_log {
                  data = {
                    action  : "tech_assist_session_triggered_from_webhook"
                    metadata: {
                    job_id         : $job.id
                    tech_id        : $tech.id
                    response_status: $assist_session_resp.response.status
                  }
                  }
                } as $assist_trigger_log
              }
            }
          
            // Phase 1c: on tech_completion, ping the soft-block completion gate.
            // Same gate as tech_arrival; additive (does not affect the existing
            // tech_completion SMS or the HCP completion itself). If required fields
            // are missing, validate_tdr_completeness flips session status to
            // "awaiting_completion" and the escalation cron picks it up after 2hr.
            conditional {
              if (($sms_type == "tech_completion") && ($env.TECH_ASSIST_ENABLED == "true")) {
                api.request {
                  url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/validate_tdr_completeness"
                  method = "POST"
                  params = {job_id: $job.id, technician_id: $tech.id}
                  headers = ["Content-Type: application/json"]
                } as $validate_resp
              
                var $validate_body {
                  value = $validate_resp.response.result
                }
              
                conditional {
                  if (($validate_body != null) && ($validate_body.complete == false)) {
                    db.add event_log {
                      data = {
                        action  : "tdr_completion_pending_followup"
                        metadata: {
                        job_id        : $job.id
                        tech_id       : $tech.id
                        session_id    : $validate_body.session_id
                        missing_fields: $validate_body.missing
                      }
                      }
                    } as $followup_log
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  response = {status: "success"}
  guid = "Hsz_ntRr-0uv6bajYETP-qaXRz4"
}