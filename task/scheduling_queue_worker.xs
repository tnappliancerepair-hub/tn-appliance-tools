//  Scheduling queue worker — runs every minute. Two responsibilities per tick:
//    1. Pull pending scheduling_queue rows, dispatch to action handlers, mark done.
//    2. Sweep expired broadcast_attempt rows, mark them expired, queue escalate.
// 
//  Test-mode flag: $env.SCHEDULING_QUEUE_ENABLED == "true" required to run.
//  Anything else (unset, "false", etc.) exits before any reads or writes.
// 
//  Phase 5 status:
//    broadcast -> REAL handler
//    book      -> STUB
//    propose   -> REAL handler (sends to owner via +16292840444)
//    wait      -> real no-op
//    notify    -> STUB
//    escalate  -> STUB
task scheduling_queue_worker {
  stack {
    conditional {
      if ($env.SCHEDULING_QUEUE_ENABLED != "true") {
        debug.log {
          value = "scheduling_queue_worker skipped: SCHEDULING_QUEUE_ENABLED != 'true'"
        }
      
        return {
          value = null
        }
      }
    }
  
    // Ant Scheduler Block 4 — sort by priority DESC first (flex_score-driven)
    // so customers with wider availability windows process sooner; created_at
    // ASC is the FIFO tiebreaker.
    db.query scheduling_queue {
      where = $db.scheduling_queue.status == "pending"
      sort = {scheduling_queue.priority: "desc", scheduling_queue.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 10}}
    } as $pending_rows
  
    var $processed_count {
      value = 0
    }
  
    foreach ($pending_rows.items) {
      each as $row {
        db.edit scheduling_queue {
          field_name = "id"
          field_value = $row.id
          data = {status: "processing"}
        } as $claimed
      
        var $job {
          value = null
        }
      
        conditional {
          if ($row.job_id != null) {
            db.get jobs {
              field_name = "id"
              field_value = $row.job_id
            } as $job_fetched
          
            var.update $job {
              value = $job_fetched
            }
          }
        }
      
        var $result_notes {
          value = ""
        }
      
        var $final_status {
          value = "completed"
        }
      
        conditional {
          if ($row.action_type == "broadcast") {
            db.query broadcast_attempt {
              where = $db.broadcast_attempt.job_id == $row.job_id && $db.broadcast_attempt.status == "open"
              return = {type: "exists"}
            } as $already_open
          
            conditional {
              if ($already_open) {
                var.update $result_notes {
                  value = "broadcast already pending for job " ~ ($row.job_id|to_text) ~ " skipped"
                }
              }
            
              elseif (($job.parts_status == "parts_needed") || ($job.parts_status == "ordered")) {
                var.update $result_notes {
                  value = "broadcast skipped: waiting for parts (parts_status=" ~ ($job.parts_status ?? "") ~ ") for job " ~ ($row.job_id|to_text)
                }
              }
            
              else {
                var $cluster {
                  value = (($job.cluster ?? "")|trim)
                }
              
                conditional {
                  if ($cluster == "") {
                    db.get customer {
                      field_name = "id"
                      field_value = $job.customer_id
                    } as $customer_for_cluster
                  
                    conditional {
                      if ($customer_for_cluster != null) {
                        db.query service_zone {
                          where = $db.service_zone.zip_code == $customer_for_cluster.zip
                          return = {type: "single"}
                        } as $zone_for_cluster
                      
                        conditional {
                          if ($zone_for_cluster != null) {
                            var.update $cluster {
                              value = (($zone_for_cluster.cluster ?? "")|trim)
                            }
                          }
                        }
                      }
                    }
                  }
                }
              
                conditional {
                  if ($cluster == "") {
                    db.add scheduling_queue {
                      data = {
                        job_id     : $row.job_id
                        action_type: "escalate"
                        status     : "pending"
                      }
                    } as $no_cluster_escalate
                  
                    var.update $result_notes {
                      value = "broadcast failed: no cluster for job " ~ ($row.job_id|to_text)
                    }
                  
                    var.update $final_status {
                      value = "failed"
                    }
                  }
                
                  else {
                    db.query cluster_assignment {
                      where = $db.cluster_assignment.cluster == $cluster && $db.cluster_assignment.active == true
                      sort = {cluster_assignment.rank: "asc"}
                      return = {type: "list", paging: {page: 1, per_page: 100}}
                    } as $cluster_assignments
                  
                    var $today_ct_ts {
                      value = now|transform_timestamp:"-5 hours"
                    }
                  
                    var $today_ct_date {
                      value = $today_ct_ts|format_timestamp:"Y-m-d"
                    }
                  
                    var $today_day_name {
                      value = ($today_ct_ts|format_timestamp:"l")|to_lower
                    }
                  
                    var $qualified_techs {
                      value = []
                    }
                  
                    foreach ($cluster_assignments.items) {
                      each as $assignment {
                        db.get technicians {
                          field_name = "id"
                          field_value = $assignment.technician_id
                        } as $cand_tech
                      
                        conditional {
                          if (($cand_tech != null) && $cand_tech.active) {
                            db.query tech_availability {
                              where = $db.tech_availability.technician_id == $cand_tech.id && $db.tech_availability.blocked_date == $today_ct_date && $db.tech_availability.full_day_off == true
                              return = {type: "exists"}
                            } as $is_off_today
                          
                            conditional {
                              if ($is_off_today == false) {
                                db.query tech_preferences {
                                  where = $db.tech_preferences.tech_id == $cand_tech.id && $db.tech_preferences.strength == "hard" && $db.tech_preferences.active == true
                                  return = {type: "list", paging: {page: 1, per_page: 50}}
                                } as $hard_prefs
                              
                                var $blocked {
                                  value = false
                                }
                              
                                foreach ($hard_prefs.items) {
                                  each as $pref {
                                    conditional {
                                      if ((($pref.preference_type == "geographic") || ($pref.preference_type == "both")) && (($pref.zip_or_area ? "" : ) == ($cluster|to_lower)) && (($pref.time_window_start ? "" : ) == "")) {
                                        var.update $blocked {
                                          value = true
                                        }
                                      }
                                    
                                      else {
                                        conditional {
                                          if ((($pref.preference_type == "time") || ($pref.preference_type == "both")) && (($pref.day_of_week ? "" : ) == $today_day_name) && (($pref.time_window_start ? "" : ) == "")) {
                                            var.update $blocked {
                                              value = true
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              
                                conditional {
                                  if ($blocked == false) {
                                    var.update $qualified_techs {
                                      value = $qualified_techs|push:$cand_tech
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  
                    conditional {
                      if (($qualified_techs|count) == 0) {
                        db.add scheduling_queue {
                          data = {
                            job_id     : $row.job_id
                            action_type: "escalate"
                            status     : "pending"
                          }
                        } as $no_qual_escalate
                      
                        var.update $result_notes {
                          value = "broadcast failed: no qualified techs in cluster " ~ $cluster
                        }
                      
                        var.update $final_status {
                          value = "failed"
                        }
                      }
                    
                      else {
                        var $expires_at {
                          value = now
                            |transform_timestamp:"+30 minutes"
                        }
                      
                        db.add broadcast_attempt {
                          data = {
                            job_id        : $row.job_id
                            broadcast_type: "open_schedule_first_reply"
                            broadcast_at  : now
                            expires_at    : $expires_at
                            techs_notified: []
                            status        : "open"
                          }
                        } as $new_broadcast
                      
                        var $brand {
                          value = (($job.brand ?? "")|trim)
                        }
                      
                        var $appl {
                          value = (($job.appliance_type ?? "")|trim)
                        }
                      
                        var $problem {
                          value = (($job.problem_summary ?? "")|trim)
                        }
                      
                        var $parts {
                          value = (($job.parts_status ?? "")|trim)
                        }
                      
                        var $sms_body {
                          value = $cluster ~ ": " ~ $brand ~ " " ~ $appl ~ " " ~ $problem ~ ". " ~ $parts ~ ". who wants it?\nreply yes to grab."
                        }
                      
                        var $notified_records {
                          value = []
                        }
                      
                        foreach ($qualified_techs) {
                          each as $qt {
                            var $gate310_recipient_e164 {
                              value = "+1" ~ $qt.phone
                            }
                          
                            var $gate310_is_owner {
                              value = ($gate310_recipient_e164 == "+16154855795") || ($qt.phone == "6154855795")
                            }
                          
                            var $gate310_sms_enabled {
                              value = (($env.SMS_ENABLED ?? "false") == "true")
                            }
                          
                            var $gate310_should_send {
                              value = $gate310_sms_enabled || $gate310_is_owner
                            }
                          
                            conditional {
                              if ($gate310_should_send == false) {
                                db.add event_log {
                                  data = {
                                    action  : "sms_gated"
                                    metadata: {
                                    recipient   : $gate310_recipient_e164
                                    body_preview: $sms_body|substr:0:200
                                    gated_reason: "SMS_ENABLED=false, non-owner recipient"
                                    call_site   : "scheduling_queue_worker.xs:310"
                                    tech_id     : $qt.id
                                    job_id      : $job.id
                                  }
                                  }
                                } as $gate310_log
                              
                                var.update $notified_records {
                                  value = $notified_records
                                    |push:{tech_id: $qt.id, phone: $qt.phone, sid: "", success: false, gated: true}
                                }
                              }
                            
                              else {
                                conditional {
                                  if ($gate310_is_owner && $gate310_sms_enabled == false) {
                                    db.add event_log {
                                      data = {
                                        action  : "sms_owner_bypass"
                                        metadata: {
                                        recipient   : $gate310_recipient_e164
                                        body_preview: $sms_body|substr:0:200
                                        call_site   : "scheduling_queue_worker.xs:310"
                                        tech_id     : $qt.id
                                        job_id      : $job.id
                                      }
                                      }
                                    } as $bypass310_log
                                  }
                                }
                              
                                api.request {
                                  url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                                  method = "POST"
                                  params = {
                                    From: "+16292840444"
                                    To  : "+1" ~ $qt.phone
                                    Body: $sms_body
                                  }
                                
                                  headers = [
                                    "Authorization: Basic " ~ (($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode)
                                    "Content-Type: application/x-www-form-urlencoded"
                                  ]
                                } as $tw_resp
                              
                                var $sid {
                                  value = $tw_resp.response.result.sid ?? ""
                                }
                              
                                var $ok {
                                  value = ($tw_resp.response.status >= 200) && ($tw_resp.response.status < 300)
                                }
                              
                                var.update $notified_records {
                                  value = $notified_records
                                    |push:{tech_id: $qt.id, phone: $qt.phone, sid: $sid, success: $ok}
                                }
                              }
                            }
                          }
                        }
                      
                        db.edit broadcast_attempt {
                          field_name = "id"
                          field_value = $new_broadcast.id
                          data = {techs_notified: $notified_records}
                        } as $br_updated
                      
                        var.update $result_notes {
                          value = "broadcast " ~ ($new_broadcast.id|to_text) ~ ": notified " ~ (($qualified_techs|count)|to_text) ~ " techs in cluster '" ~ $cluster ~ "', expires_at " ~ ($expires_at|format_timestamp:"H:i")
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        
          else {
            conditional {
              if ($row.action_type == "book") {
                // 2026-05-28: REAL handler. Reads scheduled_start_ms +
                // technician_id from the row's metadata (set by whoever
                // queued the book — typically broadcast PICK handler or
                // try_auto_schedule when in autonomous mode). Calls
                // auto_book_existing_job which writes the job + fires
                // APPOINTMENT_SCHEDULED (customer + tech auto-SMS chain).
                var $book_tech_id {
                  value = (($row.metadata.tech_id ?? $row.metadata.technician_id ?? 0)|to_decimal)
                }
              
                var $book_start_ms {
                  value = (($row.metadata.scheduled_start_ms ?? 0)|to_decimal)
                }
              
                conditional {
                  if ($book_tech_id > 0 && $book_start_ms > 0 && $row.job_id > 0) {
                    api.request {
                      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/auto_book_existing_job"
                      method = "POST"
                      params = {
                        job_id            : $row.job_id
                        technician_id     : $book_tech_id
                        scheduled_start_ms: $book_start_ms
                        source            : "scheduling_queue_worker_book"
                      }
                    
                      headers = ["content-type: application/json"]
                    } as $book_resp
                  
                    var.update $result_notes {
                      value = "booked job " ~ ($row.job_id|to_text) ~ " tech=" ~ ($book_tech_id|to_text) ~ " start_ms=" ~ ($book_start_ms|to_text) ~ " resp_status=" ~ ($book_resp.response.status|to_text)
                    }
                  }
                
                  else {
                    var.update $result_notes {
                      value = "[skip-book] missing fields: job_id=" ~ ($row.job_id|to_text) ~ " tech=" ~ ($book_tech_id|to_text) ~ " start=" ~ ($book_start_ms|to_text)
                    }
                  }
                }
              }
            
              else {
                conditional {
                  if ($row.action_type == "propose") {
                    var $abort {
                      value = false
                    }
                  
                    db.query jobs {
                      where = $db.jobs.id == $row.job_id
                      return = {type: "single"}
                    } as $job
                  
                    var $customer {
                      value = null
                    }
                  
                    conditional {
                      if ($job != null) {
                        db.query customer {
                          where = $db.customer.id == $job.customer_id
                          return = {type: "single"}
                        } as $cust_lookup
                      
                        var.update $customer {
                          value = $cust_lookup
                        }
                      }
                    }
                  
                    // Parts gate: do not propose if parts are pending or ordered.
                    conditional {
                      if ($job != null && (($job.parts_status == "parts_needed") || ($job.parts_status == "ordered"))) {
                        var.update $abort {
                          value = true
                        }
                      
                        var.update $result_notes {
                          value = "propose skipped: parts_status=" ~ ($job.parts_status ?? "") ~ " for job " ~ ($row.job_id|to_text)
                        }
                      
                        var.update $final_status {
                          value = "completed"
                        }
                      }
                    }
                  
                    conditional {
                      if (($job == null) || ($customer == null)) {
                        var.update $abort {
                          value = true
                        }
                      
                        var.update $result_notes {
                          value = "propose aborted: job or customer not found for job " ~ ($row.job_id|to_text)
                        }
                      
                        var.update $final_status {
                          value = "failed"
                        }
                      }
                    }
                  
                    var $cluster {
                      value = ""
                    }
                  
                    conditional {
                      if ($abort == false) {
                        var.update $cluster {
                          value = (($job.cluster ?? "")|trim)
                        }
                      
                        conditional {
                          if ($cluster == "") {
                            db.query service_zone {
                              where = $db.service_zone.zip_code == $job.service_zip
                              return = {type: "single"}
                            } as $zone_for_cluster
                          
                            conditional {
                              if ($zone_for_cluster != null) {
                                var.update $cluster {
                                  value = (($zone_for_cluster.cluster ?? "")|trim)
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  
                    conditional {
                      if (($abort == false) && ($cluster == "")) {
                        var $cust_first_nc {
                          value = (($customer.first_name ?? "")|trim)
                        }
                      
                        var $cust_last_nc {
                          value = (($customer.last_name ?? "")|trim)
                        }
                      
                        var $zip_nc {
                          value = (($job.service_zip ?? "")|trim)
                        }
                      
                        var $no_cluster_body {
                          value = "Job " ~ ($row.job_id|to_text) ~ " has no cluster - manual scheduling needed. Customer: " ~ $cust_first_nc ~ " " ~ $cust_last_nc ~ " zip: " ~ $zip_nc
                        }
                      
                        var $gate901_recipient_e164 {
                          value = ($env.OWNER_PHONE_NUMBER ?? "")|trim
                        }
                      
                        var $gate901_recipient_bare {
                          value = $gate901_recipient_e164|replace:"+1":""
                        }
                      
                        var $gate901_is_owner {
                          value = ($gate901_recipient_e164 == "+16154855795") || ($gate901_recipient_bare == "6154855795")
                        }
                      
                        var $gate901_sms_enabled {
                          value = (($env.SMS_ENABLED ?? "false") == "true")
                        }
                      
                        var $gate901_should_send {
                          value = $gate901_sms_enabled || $gate901_is_owner
                        }
                      
                        conditional {
                          if ($gate901_should_send) {
                            api.request {
                              url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                              method = "POST"
                              params = {
                                From: "+16292840444"
                                To  : $env.OWNER_PHONE_NUMBER
                                Body: $no_cluster_body
                              }
                            
                              headers = [
                                "Authorization: Basic " ~ (($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode)
                                "Content-Type: application/x-www-form-urlencoded"
                              ]
                            } as $no_cluster_sms
                          }
                        }
                      
                        var.update $result_notes {
                          value = "propose failed: no cluster for job " ~ ($row.job_id|to_text)
                        }
                      
                        var.update $final_status {
                          value = "failed"
                        }
                      
                        var.update $abort {
                          value = true
                        }
                      }
                    }
                  
                    var $options {
                      value = []
                    }
                  
                    conditional {
                      if ($abort == false) {
                        db.query cluster_assignment {
                          where = $db.cluster_assignment.cluster == $cluster && $db.cluster_assignment.active == true
                          sort = {cluster_assignment.rank: "asc"}
                          return = {type: "list", paging: {page: 1, per_page: 100}}
                        } as $cluster_assignments
                      
                        var $base_ts {
                          value = now|transform_timestamp:"-5 hours"
                        }
                      
                        foreach ($cluster_assignments.items) {
                          each as $assignment {
                            db.get technicians {
                              field_name = "id"
                              field_value = $assignment.technician_id
                            } as $tech
                          
                            conditional {
                              if (($tech != null) && $tech.active) {
                                for (7) {
                                  each as $offset {
                                    var $day_count {
                                      value = $offset + 1
                                    }
                                  
                                    var $check_ts {
                                      value = $base_ts
                                        |transform_timestamp:"+" ~ ($day_count|to_text) ~ " days"
                                    }
                                  
                                    var $check_date {
                                      value = $check_ts|format_timestamp:"Y-m-d"
                                    }
                                  
                                    var $day_name_lower {
                                      value = ($check_ts|format_timestamp:"l")|to_lower
                                    }
                                  
                                    var $day_display {
                                      value = $check_ts|format_timestamp:"D M j"
                                    }
                                  
                                    conditional {
                                      if (($day_name_lower != "saturday") && ($day_name_lower != "sunday")) {
                                        db.query tech_availability {
                                          where = $db.tech_availability.technician_id == $tech.id && $db.tech_availability.blocked_date == $check_date
                                          return = {type: "single"}
                                        } as $avail
                                      
                                        var $is_off {
                                          value = false
                                        }
                                      
                                        conditional {
                                          if (($avail != null) && $avail.full_day_off) {
                                            var.update $is_off {
                                              value = true
                                            }
                                          }
                                        }
                                      
                                        conditional {
                                          if ($is_off == false) {
                                            var $day_start_utc {
                                              value = (($check_date ~ " 00:00:00")|to_timestamp)|transform_timestamp:"+5 hours"
                                            }
                                          
                                            var $day_end_utc {
                                              value = $day_start_utc|transform_timestamp:"+1 day"
                                            }
                                          
                                            db.query jobs {
                                              where = $db.jobs.technician_id == $tech.id && $db.jobs.scheduled_start >= $day_start_utc && $db.jobs.scheduled_start < $day_end_utc && $db.jobs.scheduling_status != "canceled"
                                              return = {type: "count"}
                                            } as $day_job_count
                                          
                                            conditional {
                                              if ($day_job_count < 7) {
                                                var $win_start {
                                                  value = (($avail.start_time ?? "08:00")|trim)
                                                }
                                              
                                                var $win_end {
                                                  value = (($avail.end_time ?? "16:00")|trim)
                                                }
                                              
                                                conditional {
                                                  if ($win_start == "") {
                                                    var.update $win_start {
                                                      value = "08:00"
                                                    }
                                                  }
                                                }
                                              
                                                conditional {
                                                  if ($win_end == "") {
                                                    var.update $win_end {
                                                      value = "16:00"
                                                    }
                                                  }
                                                }
                                              
                                                var.update $options {
                                                  value = $options
                                                    |push:```
                                                      {
                                                        tech_id        : $tech.id,
                                                        tech_first_name: (($tech.first_name ?? "")|trim),
                                                        date           : $check_date,
                                                        day_name       : $day_name_lower,
                                                        day_display    : $day_display,
                                                        window         : ($win_start ~ " - " ~ $win_end)
                                                      }
                                                      ```
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
                      
                        var $pref {
                          value = (($job.customer_preference_text ?? "")|to_lower|trim)
                        }
                      
                        var $scored {
                          value = []
                        }
                      
                        foreach ($options) {
                          each as $opt {
                            var $score {
                              value = 0
                            }
                          
                            conditional {
                              if (($opt.day_name == "monday") && ($pref|contains:"monday")) {
                                var.update $score {
                                  value = $score + 3
                                }
                              }
                            }
                          
                            conditional {
                              if (($opt.day_name == "tuesday") && ($pref|contains:"tuesday")) {
                                var.update $score {
                                  value = $score + 3
                                }
                              }
                            }
                          
                            conditional {
                              if (($opt.day_name == "wednesday") && ($pref|contains:"wednesday")) {
                                var.update $score {
                                  value = $score + 3
                                }
                              }
                            }
                          
                            conditional {
                              if (($opt.day_name == "thursday") && ($pref|contains:"thursday")) {
                                var.update $score {
                                  value = $score + 3
                                }
                              }
                            }
                          
                            conditional {
                              if (($opt.day_name == "friday") && ($pref|contains:"friday")) {
                                var.update $score {
                                  value = $score + 3
                                }
                              }
                            }
                          
                            conditional {
                              if (($pref|contains:"morning") || ($pref|contains:" am")) {
                                var.update $score {
                                  value = $score + 2
                                }
                              }
                            }
                          
                            conditional {
                              if (($pref|contains:"afternoon") || ($pref|contains:" pm")) {
                                var.update $score {
                                  value = $score + 2
                                }
                              }
                            }
                          
                            conditional {
                              if (($pref|contains:"flexible") || ($pref|contains:"anytime") || ($pref|contains:"whenever") || ($pref|contains:"any day")) {
                                var.update $score {
                                  value = $score + 1
                                }
                              }
                            }
                          
                            var.update $scored {
                              value = $scored
                                |push:```
                                  {
                                    tech_id        : $opt.tech_id,
                                    tech_first_name: $opt.tech_first_name,
                                    date           : $opt.date,
                                    day_name       : $opt.day_name,
                                    day_display    : $opt.day_display,
                                    window         : $opt.window,
                                    score          : $score
                                  }
                                  ```
                            }
                          }
                        }
                      
                        var $best1 {
                          value = null
                        }
                      
                        var $best1_score {
                          value = -1
                        }
                      
                        var $best2 {
                          value = null
                        }
                      
                        var $best2_score {
                          value = -1
                        }
                      
                        var $best3 {
                          value = null
                        }
                      
                        var $best3_score {
                          value = -1
                        }
                      
                        foreach ($scored) {
                          each as $s {
                            conditional {
                              if ($s.score > $best1_score) {
                                var.update $best3 {
                                  value = $best2
                                }
                              
                                var.update $best3_score {
                                  value = $best2_score
                                }
                              
                                var.update $best2 {
                                  value = $best1
                                }
                              
                                var.update $best2_score {
                                  value = $best1_score
                                }
                              
                                var.update $best1 {
                                  value = $s
                                }
                              
                                var.update $best1_score {
                                  value = $s.score
                                }
                              }
                            
                              elseif ($s.score > $best2_score) {
                                var.update $best3 {
                                  value = $best2
                                }
                              
                                var.update $best3_score {
                                  value = $best2_score
                                }
                              
                                var.update $best2 {
                                  value = $s
                                }
                              
                                var.update $best2_score {
                                  value = $s.score
                                }
                              }
                            
                              elseif ($s.score > $best3_score) {
                                var.update $best3 {
                                  value = $s
                                }
                              
                                var.update $best3_score {
                                  value = $s.score
                                }
                              }
                            }
                          }
                        }
                      
                        var $top3 {
                          value = []
                        }
                      
                        conditional {
                          if ($best1 != null) {
                            var.update $top3 {
                              value = $top3|push:$best1
                            }
                          }
                        }
                      
                        conditional {
                          if ($best2 != null) {
                            var.update $top3 {
                              value = $top3|push:$best2
                            }
                          }
                        }
                      
                        conditional {
                          if ($best3 != null) {
                            var.update $top3 {
                              value = $top3|push:$best3
                            }
                          }
                        }
                      
                        conditional {
                          if (($top3|count) == 0) {
                            var $no_options_body {
                              value = "No slots found for job " ~ ($row.job_id|to_text) ~ " - " ~ (($customer.first_name ?? "")|trim) ~ " " ~ (($customer.last_name ?? "")|trim) ~ " - " ~ (($job.appliance_type ?? "")|trim) ~ ". Manual scheduling needed."
                            }
                          
                            var $gate902_recipient_e164 {
                              value = ($env.OWNER_PHONE_NUMBER ?? "")|trim
                            }
                          
                            var $gate902_recipient_bare {
                              value = $gate902_recipient_e164|replace:"+1":""
                            }
                          
                            var $gate902_is_owner {
                              value = ($gate902_recipient_e164 == "+16154855795") || ($gate902_recipient_bare == "6154855795")
                            }
                          
                            var $gate902_sms_enabled {
                              value = (($env.SMS_ENABLED ?? "false") == "true")
                            }
                          
                            var $gate902_should_send {
                              value = $gate902_sms_enabled || $gate902_is_owner
                            }
                          
                            conditional {
                              if ($gate902_should_send) {
                                api.request {
                                  url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                                  method = "POST"
                                  params = {
                                    From: "+16292840444"
                                    To  : $env.OWNER_PHONE_NUMBER
                                    Body: $no_options_body
                                  }
                                
                                  headers = [
                                    "Authorization: Basic " ~ (($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode)
                                    "Content-Type: application/x-www-form-urlencoded"
                                  ]
                                } as $no_options_sms
                              }
                            }
                          
                            var.update $result_notes {
                              value = "propose failed: no slots for job " ~ ($row.job_id|to_text) ~ " in cluster " ~ $cluster
                            }
                          
                            var.update $final_status {
                              value = "failed"
                            }
                          
                            var.update $abort {
                              value = true
                            }
                          }
                        }
                      
                        conditional {
                          if ($abort == false) {
                            var $top3_count {
                              value = $top3|count
                            }
                          
                            var $opt1 {
                              value = $top3|get:0
                            }
                          
                            var $cust_first_p {
                              value = (($customer.first_name ?? "")|trim)
                            }
                          
                            var $cust_last_p {
                              value = (($customer.last_name ?? "")|trim)
                            }
                          
                            var $appl_p {
                              value = (($job.appliance_type ?? "")|trim)
                            }
                          
                            var $city_p {
                              value = (($job.service_city ?? "")|trim)
                            }
                          
                            var $cust_pref_orig {
                              value = (($job.customer_preference_text ?? "")|trim)
                            }
                          
                            var $proposal_body {
                              value = "New job: " ~ $cust_first_p ~ " " ~ $cust_last_p ~ " - " ~ $appl_p ~ " - " ~ $city_p
                            }
                          
                            conditional {
                              if ($cust_pref_orig != "") {
                                var.update $proposal_body {
                                  value = $proposal_body ~ "\nCustomer said: " ~ $cust_pref_orig
                                }
                              }
                            }
                          
                            conditional {
                              if ($top3_count == 1) {
                                var.update $proposal_body {
                                  value = $proposal_body ~ "\n\nReply PICK1:\n1) " ~ (($opt1.tech_first_name ?? "")) ~ " - " ~ (($opt1.day_display ?? "")) ~ " " ~ (($opt1.window ?? ""))
                                }
                              }
                            
                              elseif ($top3_count == 2) {
                                var $opt2 {
                                  value = $top3|get:1
                                }
                              
                                var.update $proposal_body {
                                  value = $proposal_body ~ "\n\nReply PICK1 or PICK2:\n1) " ~ (($opt1.tech_first_name ?? "")) ~ " - " ~ (($opt1.day_display ?? "")) ~ " " ~ (($opt1.window ?? "")) ~ "\n2) " ~ (($opt2.tech_first_name ?? "")) ~ " - " ~ (($opt2.day_display ?? "")) ~ " " ~ (($opt2.window ?? ""))
                                }
                              }
                            
                              else {
                                var $opt2b {
                                  value = $top3|get:1
                                }
                              
                                var $opt3b {
                                  value = $top3|get:2
                                }
                              
                                var.update $proposal_body {
                                  value = $proposal_body ~ "\n\nReply PICK1, PICK2 or PICK3:\n1) " ~ (($opt1.tech_first_name ?? "")) ~ " - " ~ (($opt1.day_display ?? "")) ~ " " ~ (($opt1.window ?? "")) ~ "\n2) " ~ (($opt2b.tech_first_name ?? "")) ~ " - " ~ (($opt2b.day_display ?? "")) ~ " " ~ (($opt2b.window ?? "")) ~ "\n3) " ~ (($opt3b.tech_first_name ?? "")) ~ " - " ~ (($opt3b.day_display ?? "")) ~ " " ~ (($opt3b.window ?? ""))
                                }
                              }
                            }
                          
                            var $gate903_recipient_e164 {
                              value = ($env.OWNER_PHONE_NUMBER ?? "")|trim
                            }
                          
                            var $gate903_recipient_bare {
                              value = $gate903_recipient_e164|replace:"+1":""
                            }
                          
                            var $gate903_is_owner {
                              value = ($gate903_recipient_e164 == "+16154855795") || ($gate903_recipient_bare == "6154855795")
                            }
                          
                            var $gate903_sms_enabled {
                              value = (($env.SMS_ENABLED ?? "false") == "true")
                            }
                          
                            var $gate903_should_send {
                              value = $gate903_sms_enabled || $gate903_is_owner
                            }
                          
                            conditional {
                              if ($gate903_should_send) {
                                api.request {
                                  url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                                  method = "POST"
                                  params = {
                                    From: "+16292840444"
                                    To  : $env.OWNER_PHONE_NUMBER
                                    Body: $proposal_body
                                  }
                                
                                  headers = [
                                    "Authorization: Basic " ~ (($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode)
                                    "Content-Type: application/x-www-form-urlencoded"
                                  ]
                                } as $proposal_sms
                              }
                            }
                          
                            var $proposal_expires_at {
                              value = now|transform_timestamp:"+4 hours"
                            }
                          
                            db.add broadcast_attempt {
                              data = {
                                job_id        : $row.job_id
                                broadcast_type: "must_time_proposal"
                                broadcast_at  : now
                                expires_at    : $proposal_expires_at
                                techs_notified: $top3
                                status        : "open"
                              }
                            } as $new_proposal
                          
                            db.edit jobs {
                              field_name = "id"
                              field_value = $row.job_id
                              data = {
                                scheduling_status: "broadcasting"
                                dispatch_status  : "broadcasting"
                              }
                            } as $job_marked
                          
                            var.update $result_notes {
                              value = "proposal " ~ ($new_proposal.id|to_text) ~ " sent: " ~ ($top3_count|to_text) ~ " options for job " ~ ($row.job_id|to_text) ~ " in cluster " ~ $cluster
                            }
                          }
                        }
                      }
                    }
                  }
                
                  else {
                    conditional {
                      if ($row.action_type == "wait") {
                        var.update $result_notes {
                          value = "no-op wait for job " ~ ($row.job_id|to_text)
                        }
                      }
                    
                      else {
                        conditional {
                          if ($row.action_type == "notify") {
                            var.update $result_notes {
                              value = "[STUB] would notify for job " ~ ($row.job_id|to_text)
                            }
                          }
                        
                          else {
                            conditional {
                              if ($row.action_type == "escalate") {
                                var.update $result_notes {
                                  value = "[STUB] would escalate job " ~ ($row.job_id|to_text)
                                }
                              }
                            
                              else {
                                conditional {
                                  if ($row.action_type == "sick_day_cascade") {
                                    var $sd_tech_id {
                                      value = $row.metadata.tech_id
                                    }
                                  
                                    var $sd_sick_date {
                                      value = $row.metadata.sick_date
                                    }
                                  
                                    db.query scheduling_queue {
                                      where = $db.scheduling_queue.action_type == "sick_day_cascade" && $db.scheduling_queue.status == "completed" && $db.scheduling_queue.id != $row.id
                                      return = {type: "list", paging: {page: 1, per_page: 50}}
                                    } as $sd_completed_rows
                                  
                                    var $sd_dupe {
                                      value = false
                                    }
                                  
                                    foreach ($sd_completed_rows.items) {
                                      each as $sd_other {
                                        conditional {
                                          if ($sd_other.metadata.tech_id == $sd_tech_id && $sd_other.metadata.sick_date == $sd_sick_date) {
                                            var.update $sd_dupe {
                                              value = true
                                            }
                                          }
                                        }
                                      }
                                    }
                                  
                                    conditional {
                                      if ($sd_dupe) {
                                        var.update $result_notes {
                                          value = "duplicate sick_day_cascade for tech " ~ ($sd_tech_id|to_text) ~ " on " ~ $sd_sick_date
                                        }
                                      }
                                    
                                      else {
                                        db.get technicians {
                                          field_name = "id"
                                          field_value = $sd_tech_id
                                        } as $sick_tech
                                      
                                        conditional {
                                          if ($sick_tech == null) {
                                            var.update $result_notes {
                                              value = "sick_day_cascade failed: tech " ~ ($sd_tech_id|to_text) ~ " not found"
                                            }
                                          
                                            var.update $final_status {
                                              value = "failed"
                                            }
                                          }
                                        
                                          else {
                                            var $sd_day_start_utc {
                                              value = (($sd_sick_date ~ " 00:00:00")|to_timestamp)|transform_timestamp:"+5 hours"
                                            }
                                          
                                            var $sd_day_end_utc {
                                              value = $sd_day_start_utc|transform_timestamp:"+1 day"
                                            }
                                          
                                            db.query jobs {
                                              where = $db.jobs.technician_id == $sd_tech_id && $db.jobs.scheduled_start >= $sd_day_start_utc && $db.jobs.scheduled_start < $sd_day_end_utc && ($db.jobs.scheduling_status == "scheduled" || $db.jobs.scheduling_status == "in_progress")
                                              sort = {jobs.scheduled_start: "asc"}
                                              return = {type: "list", paging: {page: 1, per_page: 50}}
                                            } as $sd_jobs
                                          
                                            var $sd_job_count {
                                              value = $sd_jobs.items|count
                                            }
                                          
                                            var $sd_reassigned_count {
                                              value = 0
                                            }
                                          
                                            var $sd_customer_notified_count {
                                              value = 0
                                            }
                                          
                                            foreach ($sd_jobs.items) {
                                              each as $sd_job {
                                                db.get customer {
                                                  field_name = "id"
                                                  field_value = $sd_job.customer_id
                                                } as $sd_cust
                                              
                                                db.query cluster_assignment {
                                                  where = $db.cluster_assignment.cluster == $sd_job.cluster && $db.cluster_assignment.active == true && $db.cluster_assignment.technician_id != $sd_tech_id
                                                  sort = {cluster_assignment.rank: "asc"}
                                                  return = {type: "single"}
                                                } as $sd_alt_assignment
                                              
                                                var $sd_handled_via_reassign {
                                                  value = false
                                                }
                                              
                                                conditional {
                                                  if ($sd_alt_assignment != null) {
                                                    db.get technicians {
                                                      field_name = "id"
                                                      field_value = $sd_alt_assignment.technician_id
                                                    } as $sd_alt_tech
                                                  
                                                    conditional {
                                                      if ($sd_alt_tech != null && $sd_alt_tech.active) {
                                                        db.edit jobs {
                                                          field_name = "id"
                                                          field_value = $sd_job.id
                                                          data = {technician_id: $sd_alt_tech.id}
                                                        } as $sd_reassigned_job
                                                      
                                                        var.update $sd_reassigned_count {
                                                          value = $sd_reassigned_count + 1
                                                        }
                                                      
                                                        var.update $sd_handled_via_reassign {
                                                          value = true
                                                        }
                                                      
                                                        db.add event_log {
                                                          data = {
                                                            action  : "sick_day_silent_reassign"
                                                            metadata: {
                                                            job_id      : $sd_job.id
                                                            sick_tech_id: $sd_tech_id
                                                            new_tech_id : $sd_alt_tech.id
                                                            sick_date   : $sd_sick_date
                                                          }
                                                          }
                                                        } as $sd_reassign_log
                                                      }
                                                    }
                                                  }
                                                }
                                              
                                                conditional {
                                                  if ($sd_handled_via_reassign == false) {
                                                    var $sd_cust_phone_trimmed {
                                                      value = ($sd_cust.phone ?? "")|trim
                                                    }
                                                  
                                                    conditional {
                                                      if ($sd_cust_phone_trimmed != "") {
                                                        var $sd_cust_first {
                                                          value = (($sd_cust.first_name ?? "")|trim)
                                                        }
                                                      
                                                        conditional {
                                                          if ($sd_cust_first == "") {
                                                            var.update $sd_cust_first {
                                                              value = "there"
                                                            }
                                                          }
                                                        }
                                                      
                                                        var $sd_sick_first {
                                                          value = (($sick_tech.first_name ?? "")|trim)
                                                        }
                                                      
                                                        conditional {
                                                          if ($sd_sick_first == "") {
                                                            var.update $sd_sick_first {
                                                              value = "your tech"
                                                            }
                                                          }
                                                        }
                                                      
                                                        var $sd_cust_body {
                                                          value = "Hey " ~ $sd_cust_first ~ "! Quick heads up - " ~ $sd_sick_first ~ " came down sick today and I dont have another tech free in your area for today.\n\nWant me to push to tomorrow morning? Or if youd rather have someone else, I can get someone out later this week.\n\nWhat works?"
                                                        }
                                                      
                                                        var $gate575_sms_enabled {
                                                          value = (($env.SMS_ENABLED ?? "false") == "true")
                                                        }
                                                      
                                                        var $gate575_is_owner {
                                                          value = ($sd_cust_phone_trimmed == "+16154855795") || ($sd_cust_phone_trimmed == "6154855795")
                                                        }
                                                      
                                                        var $gate575_should_send {
                                                          value = $gate575_sms_enabled || $gate575_is_owner
                                                        }
                                                      
                                                        conditional {
                                                          if ($gate575_should_send) {
                                                            api.request {
                                                              url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                                                              method = "POST"
                                                              params = {
                                                                From: "+16292840444"
                                                                To  : $sd_cust.phone
                                                                Body: $sd_cust_body
                                                              }
                                                            
                                                              headers = [
                                                                "Authorization: Basic " ~ (($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode)
                                                                "Content-Type: application/x-www-form-urlencoded"
                                                              ]
                                                            } as $sd_cust_sms
                                                          
                                                            var.update $sd_customer_notified_count {
                                                              value = $sd_customer_notified_count + 1
                                                            }
                                                          }
                                                        }
                                                      }
                                                    }
                                                  }
                                                }
                                              }
                                            }
                                          
                                            var $sd_tech_msg {
                                              value = ""
                                            }
                                          
                                            conditional {
                                              if ($sd_job_count == 0) {
                                                var.update $sd_tech_msg {
                                                  value = "got you marked out today. nothing on the books. feel better."
                                                }
                                              }
                                            
                                              else {
                                                conditional {
                                                  if ($sd_customer_notified_count == 0) {
                                                    var.update $sd_tech_msg {
                                                      value = "got you covered. " ~ ($sd_reassigned_count|to_text) ~ " jobs reassigned. feel better."
                                                    }
                                                  }
                                                
                                                  else {
                                                    var.update $sd_tech_msg {
                                                      value = "sick day noted. " ~ ($sd_customer_notified_count|to_text) ~ " customers being contacted to reschedule. feel better."
                                                    }
                                                  }
                                                }
                                              }
                                            }
                                          
                                            conditional {
                                              if (($sick_tech.phone ? "" : ) != "") {
                                                var $gate667_sms_enabled {
                                                  value = (($env.SMS_ENABLED ?? "false") == "true")
                                                }
                                              
                                                var $gate667_is_owner {
                                                  value = ($sick_tech.phone == "6154855795")
                                                }
                                              
                                                var $gate667_should_send {
                                                  value = $gate667_sms_enabled || $gate667_is_owner
                                                }
                                              
                                                conditional {
                                                  if ($gate667_should_send) {
                                                    api.request {
                                                      url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                                                      method = "POST"
                                                      params = {
                                                        From: "+16292840444"
                                                        To  : "+1" ~ $sick_tech.phone
                                                        Body: $sd_tech_msg
                                                      }
                                                    
                                                      headers = [
                                                        "Authorization: Basic " ~ (($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode)
                                                        "Content-Type: application/x-www-form-urlencoded"
                                                      ]
                                                    } as $sd_tech_sms
                                                  }
                                                }
                                              }
                                            }
                                          
                                            var.update $result_notes {
                                              value = "sick_day_cascade tech=" ~ ($sd_tech_id|to_text) ~ " date=" ~ $sd_sick_date ~ " jobs=" ~ ($sd_job_count|to_text) ~ " reassigned=" ~ ($sd_reassigned_count|to_text) ~ " notified=" ~ ($sd_customer_notified_count|to_text)
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                
                                  else {
                                    var.update $result_notes {
                                      value = "[ERROR] unknown action_type: " ~ $row.action_type
                                    }
                                  
                                    var.update $final_status {
                                      value = "failed"
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
        }
      
        db.edit scheduling_queue {
          field_name = "id"
          field_value = $row.id
          data = {
            status      : $final_status
            processed_at: now
            result_notes: $result_notes
          }
        } as $finalized
      
        var.update $processed_count {
          value = $processed_count + 1
        }
      }
    }
  
    db.query broadcast_attempt {
      where = $db.broadcast_attempt.status == "open" && $db.broadcast_attempt.expires_at < now
      return = {type: "list", paging: {page: 1, per_page: 10}}
    } as $expired_broadcasts
  
    var $expired_count {
      value = 0
    }
  
    foreach ($expired_broadcasts.items) {
      each as $exp {
        db.edit broadcast_attempt {
          field_name = "id"
          field_value = $exp.id
          data = {status: "expired"}
        } as $marked_expired
      
        db.add scheduling_queue {
          data = {
            job_id     : $exp.job_id
            action_type: "escalate"
            status     : "pending"
          }
        } as $exp_escalate
      
        var.update $expired_count {
          value = $expired_count + 1
        }
      }
    }
  
    debug.log {
      value = "scheduling_queue_worker: processed " ~ ($processed_count|to_text) ~ " queue rows, expired " ~ ($expired_count|to_text) ~ " broadcasts"
    }
  }

  schedule = [{starts_on: 2026-05-03 00:00:00+0000, freq: 60}]
  guid = "SchedQueueWorker_v1_kTm8wQ4PnYr"
}