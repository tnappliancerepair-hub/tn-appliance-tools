//  HCP recurring poll (Phase 1g+ 2026-05-07 evening).
// 
//  Pulls jobs updated in HCP since the last poll and upserts them
//  into Xano. Built on top of the morning's hcp_backfill_recent_jobs
//  pattern, but driven by an updated_after window instead of newest-N,
//  gated by HCP_POLL_ENABLED for safe rollout.
// 
//  Companion task: task/hcp_poll_recent_jobs.xs runs this every 15 min.
// 
//  Verb: POST despite no inputs needed — matches existing convention
//  (xano-proxy.js routes POST by default; cron task posts an empty
//  body to invoke).
// 
//  Lookback window: max(latest hcp_updated_at on any HCP-sourced job,
//  30 min ago). The "older of the two" intentionally over-fetches so
//  missed updates from a previous failed run get reconciled.
// 
//  Idempotency: db.query jobs by housecall_pro_job_id before insert.
//  Existing rows get a partial update; new rows insert with full payload.
//  Same field mapping as hcp_backfill_recent_jobs but adds hcp_updated_at
//  and total_amount_cents writes.
// 
//  AHS warranty detection: tags-first (matches backfill), then a
//  notes-text fallback that scans for "AHS"/"American Home Shield"/
//  "homeshield"/"frontdoor" using literal-arg |contains: (which is
//  reliable; only the dynamic-arg form was buggy in our gotcha list).
// 
//  Disabled-state behavior: when HCP_POLL_ENABLED env var is unset or
//  not "true", the endpoint logs "hcp_poll_skipped_disabled" and exits.
//  Pass override_enabled=true in the request body to bypass for testing.
query hcp_poll_recent_jobs verb=POST {
  api_group = "intake"

  input {
    // Optional bypass for the env-var gate. Used during testing
    // before HCP_POLL_ENABLED is flipped on. Production cron does
    // NOT pass this — it relies on the env gate alone.
    bool? override_enabled?
  }

  stack {
    // Gate 1: feature flag. The endpoint silently no-ops unless either
    // (a) $env.HCP_POLL_ENABLED == "true" OR (b) override_enabled == true.
    var $is_enabled {
      value = ($env.HCP_POLL_ENABLED == "true") || ($input.override_enabled == true)
    }
  
    conditional {
      if ($is_enabled != true) {
        db.add event_log {
          data = {
            action  : "hcp_poll_skipped_disabled"
            metadata: {
            reason   : "HCP_POLL_ENABLED not 'true' and override_enabled not set"
            env_value: ($env.HCP_POLL_ENABLED ?? "(unset)")
          }
          }
        } as $log_skip
      
        return {
          value = {success: true, skipped: true, reason: "disabled"}
        }
      }
    }
  
    // Gate 2: API key must be present. If missing, log + exit clean.
    var $api_key {
      value = ($env.HCP_API_KEY ?? "")
    }
  
    conditional {
      if ($api_key == "") {
        db.add event_log {
          data = {
            action  : "hcp_poll_misconfigured"
            metadata: {reason: "HCP_API_KEY not set in Xano env"}
          }
        } as $log_misconf
      
        return {
          value = {success: false, error: "HCP_API_KEY missing"}
        }
      }
    }
  
    // Counters / outputs.
    var $jobs_fetched {
      value = 0
    }
  
    var $jobs_inserted {
      value = 0
    }
  
    var $jobs_updated {
      value = 0
    }
  
    var $errors_count {
      value = 0
    }
  
    var $pages_fetched {
      value = 0
    }
  
    var $stop {
      value = false
    }
  
    // Compute lookback window. Find the most-recent hcp_updated_at on
    // any HCP-sourced job; fall back to 30 minutes ago if no such row
    // exists yet. Use the older of the two to give safety overlap.
    var $thirty_min_ago {
      value = now
        |transform_timestamp:"-30 minutes"
    }
  
    db.query jobs {
      where = $db.jobs.intake_source == "hcp_backfill" || $db.jobs.intake_source == "hcp_poll" || $db.jobs.intake_source == "hcp_webhook"
      sort = {jobs.hcp_updated_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $latest_hcp_jobs
  
    var $latest_hcp_updated_at {
      value = null
    }
  
    conditional {
      if (($latest_hcp_jobs|count) > 0) {
        var $latest_row {
          value = $latest_hcp_jobs|first
        }
      
        var.update $latest_hcp_updated_at {
          value = ($latest_row.hcp_updated_at ?? null)
        }
      }
    }
  
    var $lookback_from_ts {
      value = $thirty_min_ago
    }
  
    conditional {
      if (($latest_hcp_updated_at != null) && ($latest_hcp_updated_at > 0) && ($latest_hcp_updated_at < $thirty_min_ago)) {
        var.update $lookback_from_ts {
          value = $latest_hcp_updated_at
        }
      }
    }
  
    // HCP wants ISO 8601. Convert ms timestamp.
    var $lookback_iso {
      value = $lookback_from_ts
        |format_timestamp:"Y-m-d\\TH:i:s\\Z"
    }
  
    var $now_iso {
      value = now
        |format_timestamp:"Y-m-d\\TH:i:s\\Z"
    }
  
    // Pagination loop — max 5 pages (50 jobs per run; HCP per_page caps
    // at 10 in practice). foreach over a static iterator with $stop
    // short-circuit, same pattern as the backfill endpoint.
    var $page_iter {
      value = [1, 2, 3, 4, 5]
    }
  
    foreach ($page_iter) {
      each as $page_num {
        conditional {
          if ($stop != true) {
            api.request {
              url = "https://api.housecallpro.com/jobs?per_page=10&updated_after=" ~ $lookback_iso ~ "&page=" ~ ($page_num|to_text)
              method = "GET"
              headers = [
                "Authorization: Token " ~ $api_key
                "Accept: application/json"
              ]
            
              timeout = 30
            } as $hcp_resp
          
            // Defensive: HCP non-2xx response. Log + stop, don't crash.
            conditional {
              if (($hcp_resp.response.status < 200) || ($hcp_resp.response.status >= 300)) {
                db.add event_log {
                  data = {
                    action  : "hcp_poll_api_error"
                    metadata: {
                    status: $hcp_resp.response.status
                    page  : $page_num
                    url   : "https://api.housecallpro.com/jobs?updated_after=" ~ $lookback_iso
                  }
                  }
                } as $log_api_err
              
                var.update $errors_count {
                  value = $errors_count + 1
                }
              
                var.update $stop {
                  value = true
                }
              }
            }
          
            conditional {
              if ($stop != true) {
                var $hcp_jobs {
                  value = ($hcp_resp.response.result.jobs ?? [])
                }
              
                conditional {
                  if (($hcp_jobs|count) == 0) {
                    var.update $stop {
                      value = true
                    }
                  }
                }
              
                conditional {
                  if (($hcp_jobs|count) > 0) {
                    var.update $pages_fetched {
                      value = $pages_fetched + 1
                    }
                  
                    foreach ($hcp_jobs) {
                      each as $hjob {
                        var.update $jobs_fetched {
                          value = $jobs_fetched + 1
                        }
                      
                        var $hcp_id {
                          value = ($hjob.id ?? "")
                        }
                      
                        // Customer extraction.
                        var $hcp_customer {
                          value = ($hjob.customer ?? null)
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
                      
                        // Address extraction.
                        var $hcp_addr {
                          value = ($hjob.address ?? null)
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
                      
                        // Resolve customer by phone (mirrors backfill).
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
                          }
                        }
                      
                        // First assigned HCP employee.
                        var $hcp_assigned_pro_id {
                          value = ""
                        }
                      
                        var $assigned_emps {
                          value = ($hjob.assigned_employees ?? [])
                        }
                      
                        conditional {
                          if (($assigned_emps|count) > 0) {
                            var $first_assigned {
                              value = $assigned_emps|first
                            }
                          
                            var.update $hcp_assigned_pro_id {
                              value = ($first_assigned.id ?? "")
                            }
                          }
                        }
                      
                        // Resolve tech_id from hcp pro_id via technicians lookup
                        // (Build C 2026-05-08). Mirrors hcp_job_webhook's pattern.
                        var $resolved_tech_id {
                          value = null
                        }
                      
                        conditional {
                          if (($hcp_assigned_pro_id != null) && ($hcp_assigned_pro_id != "")) {
                            db.query technicians {
                              where = $db.technicians.hcp_id == $hcp_assigned_pro_id && $db.technicians.active == true
                              return = {type: "single"}
                            } as $tech_match
                          
                            conditional {
                              if ($tech_match != null) {
                                var.update $resolved_tech_id {
                                  value = $tech_match.id
                                }
                              }
                            
                              else {
                                db.add event_log {
                                  data = {
                                    action  : "hcp_tech_pro_id_unknown"
                                    metadata: {
                                    hcp_pro_id: $hcp_assigned_pro_id
                                    hcp_job_id: $hcp_id
                                    source    : "hcp_poll"
                                  }
                                  }
                                } as $log_unknown_tech
                              }
                            }
                          }
                        }
                      
                        // Multi-tech detection — log when HCP assigns more
                        // than one employee. We still take the first; the
                        // log makes the multi-assignment auditable.
                        conditional {
                          if (($assigned_emps|count) > 1) {
                            db.add event_log {
                              data = {
                                action  : "hcp_multi_tech_assignment"
                                metadata: {
                                hcp_job_id  : $hcp_id
                                count       : $assigned_emps|count
                                first_pro_id: $hcp_assigned_pro_id
                                source      : "hcp_poll"
                              }
                              }
                            } as $log_multi_tech
                          }
                        }
                      
                        // Tag-driven appliance + warranty derivation.
                        var $job_tags {
                          value = ($hjob.tags ?? [])
                        }
                      
                        var $derived_appliance {
                          value = null
                        }
                      
                        var $is_warranty {
                          value = false
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
                          
                            conditional {
                              if (($tag_lower == "ahs") || ($tag_lower == "warranty") || ($tag_lower == "american home shield") || ($tag_lower == "squaretrade") || ($tag_lower == "frontdoor")) {
                                var.update $is_warranty {
                                  value = true
                                }
                              }
                            }
                          }
                        }
                      
                        // Schedule extraction.
                        var $sched {
                          value = ($hjob.schedule ?? null)
                        }
                      
                        var $sched_start_raw {
                          value = ($sched.scheduled_start ?? null)
                        }
                      
                        var $sched_end_raw {
                          value = ($sched.scheduled_end ?? null)
                        }
                      
                        var $start_ts {
                          value = ($sched_start_raw == null) ? null : ($sched_start_raw|to_timestamp)
                        }
                      
                        var $end_ts {
                          value = ($sched_end_raw == null) ? null : ($sched_end_raw|to_timestamp)
                        }
                      
                        var $work_status {
                          value = ($hjob.work_status ?? "")
                        }
                      
                        var $description {
                          value = ($hjob.description ?? "")
                        }
                      
                        var $total_amount_cents_val {
                          value = ($hjob.total_amount ?? 0)
                        }
                      
                        // Concatenate notes into single text blob.
                        var $job_notes_arr {
                          value = ($hjob.notes ?? [])
                        }
                      
                        var $combined_notes {
                          value = ""
                        }
                      
                        foreach ($job_notes_arr) {
                          each as $note {
                            var $note_content {
                              value = ($note.content ?? "")
                            }
                          
                            var.update $combined_notes {
                              value = $combined_notes ~ "\n---\n" ~ $note_content
                            }
                          }
                        }
                      
                        // ====================================================
                        // Fix A 2026-05-08: notes-content fallback for
                        // appliance_type. HCP's /jobs list endpoint returns
                        // tags=[] for many records. AHS authorization
                        // template includes "Item 1: <Appliance>" verbatim.
                        // ====================================================
                        conditional {
                          if ($derived_appliance == null) {
                            var $notes_lower_a {
                              value = ($combined_notes ?? "")|to_lower
                            }
                          
                            conditional {
                              if (($notes_lower_a|contains:"refrigerator") || ($notes_lower_a|contains:"fridge")) {
                                var.update $derived_appliance {
                                  value = "refrigerator"
                                }
                              }
                            }
                          
                            conditional {
                              if (($derived_appliance == null) && ($notes_lower_a|contains:"dishwasher")) {
                                var.update $derived_appliance {
                                  value = "dishwasher"
                                }
                              }
                            }
                          
                            conditional {
                              if (($derived_appliance == null) && (($notes_lower_a|contains:"washer") || ($notes_lower_a|contains:"washing machine"))) {
                                var.update $derived_appliance {
                                  value = "washer"
                                }
                              }
                            }
                          
                            conditional {
                              if (($derived_appliance == null) && ($notes_lower_a|contains:"dryer")) {
                                var.update $derived_appliance {
                                  value = "dryer"
                                }
                              }
                            }
                          
                            conditional {
                              if (($derived_appliance == null) && (($notes_lower_a|contains:"range") || ($notes_lower_a|contains:"oven") || ($notes_lower_a|contains:"stove") || ($notes_lower_a|contains:"cooktop"))) {
                                var.update $derived_appliance {
                                  value = "range"
                                }
                              }
                            }
                          
                            conditional {
                              if (($derived_appliance == null) && ($notes_lower_a|contains:"microwave")) {
                                var.update $derived_appliance {
                                  value = "microwave"
                                }
                              }
                            }
                          
                            conditional {
                              if ($derived_appliance != null) {
                                db.add event_log {
                                  data = {
                                    action  : "appliance_derived_from_notes"
                                    metadata: {
                                    hcp_id       : $hcp_id
                                    derived_value: $derived_appliance
                                    source       : "hcp_poll"
                                  }
                                  }
                                } as $log_appliance_fallback
                              }
                            }
                          }
                        }
                      
                        // AHS-via-notes fallback warranty detection
                        // (existing in poll since 2026-05-07 evening; Fix A
                        // 2026-05-08 adds event-logging when fallback fires).
                        conditional {
                          if ($is_warranty != true) {
                            var $notes_lower {
                              value = $combined_notes|to_lower
                            }
                          
                            conditional {
                              if (($notes_lower|contains:"ahs:") || ($notes_lower|contains:"ahs ") || ($notes_lower|contains:"american home shield") || ($notes_lower|contains:"homeshield") || ($notes_lower|contains:"frontdoor")) {
                                var.update $is_warranty {
                                  value = true
                                }
                              }
                            }
                          
                            conditional {
                              if ($is_warranty) {
                                db.add event_log {
                                  data = {
                                    action  : "warranty_derived_from_notes"
                                    metadata: {hcp_id: $hcp_id, source: "hcp_poll"}
                                  }
                                } as $log_warranty_fallback
                              }
                            }
                          }
                        }
                      
                        var $customer_type {
                          value = ($is_warranty == true) ? "warranty" : "self_pay"
                        }
                      
                        // HCP updated_at timestamp for next poll's window.
                        var $hcp_updated_at_raw {
                          value = ($hjob.updated_at ?? null)
                        }
                      
                        var $hcp_updated_at_ts {
                          value = ($hcp_updated_at_raw == null) ? now : ($hcp_updated_at_raw|to_timestamp)
                        }
                      
                        // Idempotency lookup.
                        db.query jobs {
                          where = $db.jobs.housecall_pro_job_id == $hcp_id
                          return = {type: "single"}
                        } as $existing_job
                      
                        conditional {
                          if ($existing_job != null) {
                            // Capture old hcp_assigned_to BEFORE the db.edit
                            // overwrites it. Used by hybrid reassignment
                            // logic below (Build C 2026-05-08).
                            var $old_hcp_pro_id {
                              value = ($existing_job.hcp_assigned_to ?? "")
                            }
                          
                            // Update mutable fields only. Don't overwrite
                            // intake_source, customer_type (manual changes
                            // by Teddy/Danielle survive), or any
                            // non-HCP-authoritative state.
                            // Gap 1 fix: derive scheduling_status from HCP
                            // work_status so the field reflects reality.
                            // Falls back to existing scheduling_status when
                            // HCP work_status doesn't map to one of our known
                            // states (preserves manual triage values).
                            var $work_status_lower_upd {
                              value = ($work_status ?? "")|to_lower|trim
                            }
                          
                            var $derived_sched_status_upd {
                              value = ($existing_job.scheduling_status ?? "not_ready")
                            }
                          
                            conditional {
                              if (($work_status_lower_upd == "scheduled") || ($work_status_lower_upd == "in progress") || ($work_status_lower_upd == "in_progress") || ($work_status_lower_upd == "schedule appointment") || ($work_status_lower_upd == "schedule_appointment")) {
                                var.update $derived_sched_status_upd {
                                  value = "scheduled"
                                }
                              }
                            
                              elseif (($work_status_lower_upd == "completed") || ($work_status_lower_upd == "complete") || ($work_status_lower_upd == "complete unrated") || ($work_status_lower_upd == "complete_unrated") || ($work_status_lower_upd == "complete rated") || ($work_status_lower_upd == "complete_rated")) {
                                var.update $derived_sched_status_upd {
                                  value = "completed"
                                }
                              }
                            
                              elseif (($work_status_lower_upd == "canceled") || ($work_status_lower_upd == "cancelled") || ($work_status_lower_upd == "pro canceled") || ($work_status_lower_upd == "pro_canceled") || ($work_status_lower_upd == "pro cancelled") || ($work_status_lower_upd == "pro_cancelled")) {
                                var.update $derived_sched_status_upd {
                                  value = "canceled"
                                }
                              }
                            }
                          
                            db.edit jobs {
                              field_name = "id"
                              field_value = $existing_job.id
                              data = {
                                hcp_assigned_to   : $hcp_assigned_pro_id
                                scheduled_start   : $start_ts
                                scheduled_end     : $end_ts
                                current_status    : $work_status
                                scheduling_status : $derived_sched_status_upd
                                notes_internal    : $combined_notes
                                hcp_updated_at    : $hcp_updated_at_ts
                                total_amount_cents: $total_amount_cents_val
                              }
                            } as $edited_job
                          
                            var.update $jobs_updated {
                              value = $jobs_updated + 1
                            }
                          
                            db.add event_log {
                              data = {
                                action  : "hcp_poll_updated"
                                metadata: {
                                hcp_id     : $hcp_id
                                xano_job_id: $existing_job.id
                                page       : $page_num
                              }
                              }
                            } as $log_upd
                          
                            // Phase 5A: emit JOB_COMPLETED on warranty-job completion transition.
                            var $jcc_new_status_lower {
                              value = ($work_status ?? "")|to_lower
                            }
                          
                            var $jcc_old_status_lower {
                              value = ($existing_job.current_status ?? "")|to_lower
                            }
                          
                            var $jcc_is_completed_now {
                              value = ($jcc_new_status_lower == "complete") || ($jcc_new_status_lower == "completed")
                            }
                          
                            var $jcc_was_completed_before {
                              value = ($jcc_old_status_lower == "complete") || ($jcc_old_status_lower == "completed")
                            }
                          
                            var $jcc_is_warranty {
                              value = (($existing_job.customer_type ?? "") == "warranty")
                            }
                          
                            var $jcc_should_emit {
                              value = $jcc_is_completed_now && ($jcc_was_completed_before == false) && $jcc_is_warranty
                            }
                          
                            conditional {
                              if ($jcc_should_emit) {
                                var $jcc_warranty_company {
                                  value = ($existing_job.warranty_company ?? "")
                                }
                              
                                var $jcc_claim_number {
                                  value = ($existing_job.claim_number ?? "")
                                }
                              
                                var $jcc_completed_at_ms {
                                  value = now|to_ms
                                }
                              
                                var $jcc_payload_obj {
                                  value = {
                                    job_id          : $existing_job.id
                                    source          : "hcp_poll_completed"
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
                                    job_id          : $existing_job.id
                                    signal_id       : $jcc_signal.id
                                    source          : "hcp_poll_completed"
                                    warranty_company: $jcc_warranty_company
                                  }
                                  }
                                } as $jcc_log
                              }
                            }
                          
                            // Phase 5.5C: emit APPOINTMENT_SCHEDULED when poll
                            // detects scheduled_start moved to a new value
                            // (skip when same time was re-synced from HCP).
                            var $as_old_start {
                              value = ($existing_job.scheduled_start ?? 0)
                            }
                          
                            var $as_new_start {
                              value = ($start_ts ?? 0)
                            }
                          
                            var $as_should_emit_upd {
                              value = ($as_new_start > 0) && ($as_new_start != $as_old_start)
                            }
                          
                            conditional {
                              if ($as_should_emit_upd) {
                                var $as_payload_upd_obj {
                                  value = {
                                    job_id            : $existing_job.id
                                    scheduled_start_ms: $as_new_start
                                    scheduled_end_ms  : ($end_ts ?? null)
                                    technician_id     : ($resolved_tech_id ?? ($existing_job.technician_id ?? 0))
                                    source            : "hcp_poll_update"
                                  }
                                }
                              
                                var $as_payload_upd_str {
                                  value = $as_payload_upd_obj|json_encode
                                }
                              
                                db.add colony_signals {
                                  data = {
                                    signal_type    : "APPOINTMENT_SCHEDULED"
                                    signal_strength: 60
                                    source_colony  : ""
                                    target_colonies: ""
                                    payload        : $as_payload_upd_str
                                  }
                                } as $as_signal_upd
                              
                                db.add event_log {
                                  data = {
                                    action  : "appointment_scheduled_signal_emitted"
                                    metadata: {
                                    job_id            : $existing_job.id
                                    signal_id         : $as_signal_upd.id
                                    scheduled_start_ms: $as_new_start
                                    source            : "hcp_poll_update"
                                  }
                                  }
                                } as $as_log_upd
                              }
                            }
                          
                            // Hybrid reassignment sync (Build C 2026-05-08):
                            // only update technician_id when HCP's
                            // assigned_employees actually changed. If
                            // unchanged, preserve the existing tech_id
                            // (could be a Phase 3 Xano-side override).
                            conditional {
                              if ($old_hcp_pro_id != $hcp_assigned_pro_id) {
                                db.edit jobs {
                                  field_name = "id"
                                  field_value = $existing_job.id
                                  data = {technician_id: $resolved_tech_id}
                                } as $tech_reassign_edit
                              
                                db.add event_log {
                                  data = {
                                    action  : "hcp_tech_reassignment_synced"
                                    metadata: {
                                    hcp_job_id    : $hcp_id
                                    old_tech_id   : ($existing_job.technician_id ?? null)
                                    new_tech_id   : $resolved_tech_id
                                    old_hcp_pro_id: $old_hcp_pro_id
                                    new_hcp_pro_id: $hcp_assigned_pro_id
                                    source        : "hcp_poll"
                                  }
                                  }
                                } as $log_reassign
                              
                                // Phase 5.5A.1: emit TECH_ASSIGNED on reassignment if tech actually resolved.
                                var $ta_resolved_int {
                                  value = ($resolved_tech_id ?? 0)
                                }
                              
                                var $ta_prior_int {
                                  value = ($existing_job.technician_id ?? 0)
                                }
                              
                                var $ta_should_emit {
                                  value = ($ta_resolved_int > 0) && ($ta_resolved_int != $ta_prior_int)
                                }
                              
                                conditional {
                                  if ($ta_should_emit) {
                                    var $ta_assigned_at_ms {
                                      value = now|to_ms
                                    }
                                  
                                    var $ta_payload_obj {
                                      value = {
                                        job_id             : $existing_job.id
                                        technician_id      : $resolved_tech_id
                                        prior_technician_id: $ta_prior_int
                                        source             : "hcp_poll_reassign"
                                        assigned_at_ms     : $ta_assigned_at_ms
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
                                        job_id             : $existing_job.id
                                        signal_id          : $ta_signal.id
                                        technician_id      : $resolved_tech_id
                                        prior_technician_id: $ta_prior_int
                                        source             : "hcp_poll_reassign"
                                      }
                                      }
                                    } as $ta_log
                                  }
                                }
                              }
                            }
                          }
                        
                          else {
                            // Gap 1 fix: derive scheduling_status from HCP
                            // work_status on insert. Default to
                            // prediagnosis_pending when no mapping applies
                            // (matches the prior hardcoded behavior).
                            var $work_status_lower_ins {
                              value = ($work_status ?? "")|to_lower|trim
                            }
                          
                            var $derived_sched_status_ins {
                              value = "prediagnosis_pending"
                            }
                          
                            conditional {
                              if (($work_status_lower_ins == "scheduled") || ($work_status_lower_ins == "in progress") || ($work_status_lower_ins == "in_progress") || ($work_status_lower_ins == "schedule appointment") || ($work_status_lower_ins == "schedule_appointment")) {
                                var.update $derived_sched_status_ins {
                                  value = "scheduled"
                                }
                              }
                            
                              elseif (($work_status_lower_ins == "completed") || ($work_status_lower_ins == "complete") || ($work_status_lower_ins == "complete unrated") || ($work_status_lower_ins == "complete_unrated") || ($work_status_lower_ins == "complete rated") || ($work_status_lower_ins == "complete_rated")) {
                                var.update $derived_sched_status_ins {
                                  value = "completed"
                                }
                              }
                            
                              elseif (($work_status_lower_ins == "canceled") || ($work_status_lower_ins == "cancelled") || ($work_status_lower_ins == "pro canceled") || ($work_status_lower_ins == "pro_canceled") || ($work_status_lower_ins == "pro cancelled") || ($work_status_lower_ins == "pro_cancelled")) {
                                var.update $derived_sched_status_ins {
                                  value = "canceled"
                                }
                              }
                            }
                          
                            db.add jobs {
                              data = {
                                customer_id           : $resolved_customer_id
                                housecall_pro_job_id  : $hcp_id
                                hcp_assigned_to       : $hcp_assigned_pro_id
                                technician_id         : $resolved_tech_id
                                scheduling_status     : $derived_sched_status_ins
                                pre_diagnosis_complete: false
                                intake_source         : "hcp_poll"
                                source_type           : "hcp"
                                customer_type         : $customer_type
                                appliance_type        : $derived_appliance
                                service_address       : $svc_street
                                service_city          : $svc_city
                                service_state         : $svc_state
                                service_zip           : $svc_zip
                                notes_internal        : $combined_notes
                                problem_summary       : $description
                                current_status        : $work_status
                                job_status            : "new"
                                job_time              : "standard"
                                scheduled_start       : $start_ts
                                scheduled_end         : $end_ts
                                hcp_updated_at        : $hcp_updated_at_ts
                                total_amount_cents    : $total_amount_cents_val
                              }
                            } as $new_job
                          
                            var.update $jobs_inserted {
                              value = $jobs_inserted + 1
                            }
                          
                            db.add event_log {
                              data = {
                                action  : "hcp_poll_inserted"
                                metadata: {
                                hcp_id         : $hcp_id
                                new_xano_job_id: $new_job.id
                                customer_id    : $resolved_customer_id
                                page           : $page_num
                                customer_type  : $customer_type
                              }
                              }
                            } as $log_ins
                          
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
                                source             : "hcp_poll"
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
                                source   : "hcp_poll"
                              }
                              }
                            } as $jc_log
                          
                            // Phase 5.5A.1: emit TECH_ASSIGNED if a tech was resolved at create time.
                            var $ta_resolved_int_c {
                              value = ($resolved_tech_id ?? 0)
                            }
                          
                            conditional {
                              if ($ta_resolved_int_c > 0) {
                                var $ta_assigned_at_ms_c {
                                  value = now|to_ms
                                }
                              
                                var $ta_payload_obj_c {
                                  value = {
                                    job_id             : $new_job.id
                                    technician_id      : $resolved_tech_id
                                    prior_technician_id: null
                                    source             : "hcp_poll_create"
                                    assigned_at_ms     : $ta_assigned_at_ms_c
                                  }
                                }
                              
                                var $ta_payload_str_c {
                                  value = $ta_payload_obj_c|json_encode
                                }
                              
                                db.add colony_signals {
                                  data = {
                                    signal_type    : "TECH_ASSIGNED"
                                    signal_strength: 70
                                    source_colony  : ""
                                    target_colonies: ""
                                    payload        : $ta_payload_str_c
                                  }
                                } as $ta_signal_c
                              
                                db.add event_log {
                                  data = {
                                    action  : "tech_assigned_signal_emitted"
                                    metadata: {
                                    job_id       : $new_job.id
                                    signal_id    : $ta_signal_c.id
                                    technician_id: $resolved_tech_id
                                    source       : "hcp_poll_create"
                                  }
                                  }
                                } as $ta_log_c
                              }
                            }
                          
                            // Phase 5.5C: emit APPOINTMENT_SCHEDULED when a
                            // new HCP-poll-sourced job lands with a real
                            // scheduled_start. Gates out null/zero starts.
                            var $as_create_start {
                              value = ($start_ts ?? 0)
                            }
                          
                            conditional {
                              if ($as_create_start > 0) {
                                var $as_payload_ins_obj {
                                  value = {
                                    job_id            : $new_job.id
                                    scheduled_start_ms: $as_create_start
                                    scheduled_end_ms  : ($end_ts ?? null)
                                    technician_id     : ($resolved_tech_id ?? 0)
                                    source            : "hcp_poll_create"
                                  }
                                }
                              
                                var $as_payload_ins_str {
                                  value = $as_payload_ins_obj|json_encode
                                }
                              
                                db.add colony_signals {
                                  data = {
                                    signal_type    : "APPOINTMENT_SCHEDULED"
                                    signal_strength: 60
                                    source_colony  : ""
                                    target_colonies: ""
                                    payload        : $as_payload_ins_str
                                  }
                                } as $as_signal_ins
                              
                                db.add event_log {
                                  data = {
                                    action  : "appointment_scheduled_signal_emitted"
                                    metadata: {
                                    job_id            : $new_job.id
                                    signal_id         : $as_signal_ins.id
                                    scheduled_start_ms: $as_create_start
                                    source            : "hcp_poll_create"
                                  }
                                  }
                                } as $as_log_ins
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  
    // One run-summary event_log entry. Schema uses `action` + `metadata`
    // (the spec said event_type/event_data — corrected to match table).
    db.add event_log {
      data = {
        action  : "hcp_poll_run"
        metadata: {
        lookback_from: $lookback_iso
        lookback_to  : $now_iso
        jobs_fetched : $jobs_fetched
        jobs_inserted: $jobs_inserted
        jobs_updated : $jobs_updated
        errors_count : $errors_count
        pages_fetched: $pages_fetched
        override_used: ($input.override_enabled ?? false)
      }
      }
    } as $log_run
  }

  response = {
    success      : true
    skipped      : false
    lookback_from: $lookback_iso
    lookback_to  : $now_iso
    jobs_fetched : $jobs_fetched
    jobs_inserted: $jobs_inserted
    jobs_updated : $jobs_updated
    errors_count : $errors_count
    pages_fetched: $pages_fetched
  }

  guid = "hcp-poll-recent-jobs-2026-05-07"
}