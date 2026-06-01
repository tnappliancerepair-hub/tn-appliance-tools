//  One-shot HCP backfill (Phase 1g+ 2026-05-07).
// 
//  Pages through HCP /jobs sorted by created_at desc and creates any
//  matching Xano jobs that don't yet exist (idempotent — looks up by
//  housecall_pro_job_id before insert). Mirrors the create-branch
//  logic of hcp_job_webhook_POST.xs (lines ~247-426) but reads from
//  the HCP API response shape (top-level job object) instead of the
//  webhook's $body.job.
// 
//  Use case: HCP webhooks have been arriving sparse (only event field,
//  no payload) since 2026-05-05, so we fall back to polling. This is
//  a one-shot manual run; the cron version comes later.
// 
//  Page iteration: XanoScript has no while-loop primitive that I can
//  safely rely on, so we foreach over a static [1..20] array and
//  short-circuit via $stop when HCP returns an empty page or we hit
//  the user-supplied max_pages cap.
query hcp_backfill_recent_jobs verb=POST {
  api_group = "intake"

  input {
    int? max_pages?
    int? per_page?
    bool? dry_run?
  }

  stack {
    // Caps and defaults.
    var $max_pages_raw {
      value = ($input.max_pages ?? 5)
    }
  
    var $max_pages {
      value = ($max_pages_raw > 20) ? 20 : $max_pages_raw
    }
  
    var $per_page_raw {
      value = ($input.per_page ?? 10)
    }
  
    var $per_page {
      value = ($per_page_raw > 25) ? 25 : $per_page_raw
    }
  
    var $dry_run {
      value = ($input.dry_run ?? false)
    }
  
    // Counters / outputs.
    var $created_count {
      value = 0
    }
  
    var $skipped_count {
      value = 0
    }
  
    var $error_count {
      value = 0
    }
  
    var $pages_fetched {
      value = 0
    }
  
    var $jobs_seen {
      value = 0
    }
  
    var $first_hcp_id {
      value = ""
    }
  
    var $last_hcp_id {
      value = ""
    }
  
    var $stop {
      value = false
    }
  
    // Static page iterator capped at 20 (matches max_pages ceiling).
    var $page_iter {
      value = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
    }
  
    foreach ($page_iter) {
      each as $page_num {
        conditional {
          if (($page_num <= $max_pages) && ($stop != true)) {
            api.request {
              url = "https://api.housecallpro.com/jobs?per_page=" ~ ($per_page|to_text) ~ "&sort=created_at&direction=desc&page=" ~ ($page_num|to_text)
              method = "GET"
              headers = [
                "Authorization: Token " ~ $env.HCP_API_KEY
                "Accept: application/json"
              ]
            
              timeout = 30
            } as $hcp_resp
          
            var $hcp_jobs {
              value = ($hcp_resp.response.result.jobs ?? [])
            }
          
            // Empty page → break out of remaining iterations.
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
                    var.update $jobs_seen {
                      value = $jobs_seen + 1
                    }
                  
                    var $hcp_id {
                      value = ($hjob.id ?? "")
                    }
                  
                    conditional {
                      if ($jobs_seen == 1) {
                        var.update $first_hcp_id {
                          value = $hcp_id
                        }
                      }
                    }
                  
                    var.update $last_hcp_id {
                      value = $hcp_id
                    }
                  
                    // Idempotency: skip if Xano already has this HCP id.
                    db.query jobs {
                      where = $db.jobs.housecall_pro_job_id == $hcp_id
                      return = {type: "single"}
                    } as $existing_job
                  
                    conditional {
                      if ($existing_job != null) {
                        var.update $skipped_count {
                          value = $skipped_count + 1
                        }
                      
                        db.add event_log {
                          data = {
                            action  : "hcp_backfill_skip_exists"
                            metadata: {
                            hcp_id     : $hcp_id
                            xano_job_id: $existing_job.id
                            page       : $page_num
                          }
                          }
                        } as $log_skip
                      }
                    
                      else {
                        // Pull customer fields from HCP response.
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
                      
                        // Pull address.
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
                      
                        // Resolve customer by phone (matches webhook handler
                        // pattern). Customer table has no hcp_customer_id
                        // column — adding one is a separate change.
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
                            // Only create customer when not in dry_run.
                            conditional {
                              if ($dry_run != true) {
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
                          }
                        }
                      
                        // First assigned HCP employee (mirrors webhook).
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
                      
                        // Resolve tech_id from hcp pro_id (Build C 2026-05-08).
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
                                    page      : $page_num
                                    source    : "hcp_backfill"
                                  }
                                  }
                                } as $log_unknown_tech
                              }
                            }
                          }
                        }
                      
                        // Multi-tech detection.
                        conditional {
                          if (($assigned_emps|count) > 1) {
                            db.add event_log {
                              data = {
                                action  : "hcp_multi_tech_assignment"
                                metadata: {
                                hcp_job_id  : $hcp_id
                                count       : $assigned_emps|count
                                first_pro_id: $hcp_assigned_pro_id
                                page        : $page_num
                                source      : "hcp_backfill"
                              }
                              }
                            } as $log_multi_tech
                          }
                        }
                      
                        // Tag-driven derivations: appliance_type + warranty.
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
                      
                        // $customer_type is computed AFTER the notes-content
                        // fallbacks below (Fix A 2026-05-08), so warranty
                        // signals derived from notes get honored.
                      
                        // Schedule extraction. HCP returns object under
                        // `schedule`. Field names per HCP API doc samples
                        // are scheduled_start / scheduled_end. Defensive
                        // fallback to null if absent.
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
                      
                        // Combine note bodies into a single text blob for
                        // notes_internal. Defensive — notes may be missing
                        // or non-array on some payloads.
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
                        // tags=[] for many records that /jobs/<id> shows
                        // populated. Falls back to scanning notes for the
                        // verbatim AHS template "Item 1: <Appliance>".
                        // ====================================================
                        conditional {
                          if ($derived_appliance == null) {
                            var $notes_lower {
                              value = ($combined_notes ?? "")|to_lower
                            }
                          
                            conditional {
                              if (($notes_lower|contains:"refrigerator") || ($notes_lower|contains:"fridge")) {
                                var.update $derived_appliance {
                                  value = "refrigerator"
                                }
                              }
                            }
                          
                            conditional {
                              if (($derived_appliance == null) && ($notes_lower|contains:"dishwasher")) {
                                var.update $derived_appliance {
                                  value = "dishwasher"
                                }
                              }
                            }
                          
                            conditional {
                              if (($derived_appliance == null) && (($notes_lower|contains:"washer") || ($notes_lower|contains:"washing machine"))) {
                                var.update $derived_appliance {
                                  value = "washer"
                                }
                              }
                            }
                          
                            conditional {
                              if (($derived_appliance == null) && ($notes_lower|contains:"dryer")) {
                                var.update $derived_appliance {
                                  value = "dryer"
                                }
                              }
                            }
                          
                            conditional {
                              if (($derived_appliance == null) && (($notes_lower|contains:"range") || ($notes_lower|contains:"oven") || ($notes_lower|contains:"stove") || ($notes_lower|contains:"cooktop"))) {
                                var.update $derived_appliance {
                                  value = "range"
                                }
                              }
                            }
                          
                            conditional {
                              if (($derived_appliance == null) && ($notes_lower|contains:"microwave")) {
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
                                    page         : $page_num
                                    derived_value: $derived_appliance
                                    source       : "hcp_backfill"
                                  }
                                  }
                                } as $log_appliance_fallback
                              }
                            }
                          }
                        }
                      
                        // ====================================================
                        // Fix A 2026-05-08: notes-content fallback for
                        // warranty detection (mirrors reclassify_ahs_jobs).
                        // ====================================================
                        conditional {
                          if ($is_warranty != true) {
                            var $notes_lower_w {
                              value = ($combined_notes ?? "")|to_lower
                            }
                          
                            conditional {
                              if (($notes_lower_w|contains:"american home shield") || ($notes_lower_w|contains:"homeshield") || ($notes_lower_w|contains:"frontdoor") || ($notes_lower_w|contains:"ahs:") || ($notes_lower_w|contains:"ahs ")) {
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
                                    metadata: {
                                    hcp_id: $hcp_id
                                    page  : $page_num
                                    source: "hcp_backfill"
                                  }
                                  }
                                } as $log_warranty_fallback
                              }
                            }
                          }
                        }
                      
                        // (Moved from earlier — recomputed after both fallbacks.)
                        var $customer_type {
                          value = ($is_warranty == true) ? "warranty" : "self_pay"
                        }
                      
                        // Either log a dry_run intent or actually create.
                        conditional {
                          if ($dry_run) {
                            db.add event_log {
                              data = {
                                action  : "hcp_backfill_dry_run_would_create"
                                metadata: {
                                hcp_id        : $hcp_id
                                page          : $page_num
                                customer_first: $cust_first
                                customer_last : $cust_last
                                customer_phone: $cust_phone
                                appliance_type: $derived_appliance
                                customer_type : $customer_type
                                service_city  : $svc_city
                                service_zip   : $svc_zip
                                work_status   : $work_status
                              }
                              }
                            } as $log_dry
                          
                            var.update $created_count {
                              value = $created_count + 1
                            }
                          }
                        
                          else {
                            db.add jobs {
                              data = {
                                customer_id           : $resolved_customer_id
                                housecall_pro_job_id  : $hcp_id
                                hcp_assigned_to       : $hcp_assigned_pro_id
                                technician_id         : $resolved_tech_id
                                scheduling_status     : "prediagnosis_pending"
                                pre_diagnosis_complete: false
                                intake_source         : "hcp_backfill"
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
                              }
                            } as $new_job
                          
                            var.update $created_count {
                              value = $created_count + 1
                            }
                          
                            db.add event_log {
                              data = {
                                action  : "hcp_backfill_created"
                                metadata: {
                                hcp_id         : $hcp_id
                                new_xano_job_id: $new_job.id
                                customer_id    : $resolved_customer_id
                                page           : $page_num
                                customer_type  : $customer_type
                                appliance_type : $derived_appliance
                              }
                              }
                            } as $log_create
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

  response = {
    success      : true
    pages_fetched: $pages_fetched
    jobs_seen    : $jobs_seen
    created      : $created_count
    skipped      : $skipped_count
    errors       : $error_count
    dry_run      : $dry_run
    first_hcp_id : $first_hcp_id
    last_hcp_id  : $last_hcp_id
  }

  guid = "hcp-backfill-recent-jobs-2026-05-07"
}