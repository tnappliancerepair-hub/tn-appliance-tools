//  Daily tech summary cron — runs every 15 minutes, finds techs whose
//  daily_summary_time falls in the current 15-min CT window, and texts each
//  of them today's job rundown via Twilio.
// 
//  Test-mode flag: gated by $env.DAILY_SUMMARY_ENABLED == "true". If unset
//  or anything else, the task exits before any DB read or SMS send.
// 
//  Time zone: all comparisons in Central Time (TN locale).
//    - daily_summary_time stored as CT local HH:MM ("06:00")
//    - we convert UTC `now` → CT via transform_timestamp:"-5 hours" (CDT)
//    - DST: hardcoded -5 for CDT (Mar–Nov). Switch to -6 for CST when
//      the November 2026 DST end approaches. TODO: tz-aware filter.
// 
//  Dedupe: composite index on (tech_id, sent_for_date) in daily_summary_log.
//  We INSERT the log row after the SMS attempt regardless of Twilio status,
//  so a Twilio failure doesn't cause repeated retries within the same day.
// 
//  Schedule: freq=900 (15 min). Window slightly wider than 15 min (16 min
//  lookback) to absorb cron drift.
task daily_tech_summary {
  stack {
    // ────────────────────────────────────────────────────────
    // 0. Test-mode guard.
    // ────────────────────────────────────────────────────────
    conditional {
      if ($env.DAILY_SUMMARY_ENABLED != "true") {
        debug.log {
          value = "daily_tech_summary skipped: DAILY_SUMMARY_ENABLED != 'true'"
        }
      
        return {
          value = null
        }
      }
    }
  
    // ────────────────────────────────────────────────────────
    // 1. Time computations in Central Time (CDT, -5h offset).
    // ────────────────────────────────────────────────────────
    var $now_ct_ts {
      value = now|transform_timestamp:"-5 hours"
    }
  
    var $now_ct_hhmm {
      value = $now_ct_ts|format_timestamp:"H:i"
    }
  
    var $window_start_ct_hhmm {
      value = ($now_ct_ts|transform_timestamp:"-16 minutes")|format_timestamp:"H:i"
    }
  
    var $today_ct_date {
      value = $now_ct_ts|format_timestamp:"Y-m-d"
    }
  
    // Today's CT day boundaries expressed as UTC timestamps for jobs filter.
    // Midnight CT = 05:00 UTC during CDT.
    var $today_ct_start_utc {
      value = (($today_ct_date ~ " 00:00:00")|to_timestamp)|transform_timestamp:"+5 hours"
    }
  
    var $today_ct_end_utc {
      value = $today_ct_start_utc|transform_timestamp:"+1 day"
    }
  
    // ────────────────────────────────────────────────────────
    // 2. Find techs whose daily_summary_time falls in current window.
    //    Window: (now-16min, now] in CT HH:MM string form.
    // ────────────────────────────────────────────────────────
    db.query technicians {
      where = $db.technicians.active == true && $db.technicians.onboarding_completed_at > 0 && $db.technicians.daily_summary_time != null && $db.technicians.daily_summary_time != "" && $db.technicians.daily_summary_time > $window_start_ct_hhmm && $db.technicians.daily_summary_time <= $now_ct_hhmm
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $matching_techs
  
    // ────────────────────────────────────────────────────────
    // 3. For each matching tech: dedupe, build summary, send, log.
    // ────────────────────────────────────────────────────────
    foreach ($matching_techs.items) {
      each as $tech {
        // 3a. Dedupe — skip if log row already exists for (tech, today).
        db.query daily_summary_log {
          where = $db.daily_summary_log.tech_id == $tech.id && $db.daily_summary_log.sent_for_date == $today_ct_date
          return = {type: "exists"}
        } as $already_sent
      
        conditional {
          if ($already_sent == false) {
            // 3b. Pull today's jobs assigned to this tech.
            db.query jobs {
              where = $db.jobs.technician_id == $tech.id && $db.jobs.scheduled_start >= $today_ct_start_utc && $db.jobs.scheduled_start < $today_ct_end_utc && ($db.jobs.scheduling_status == "scheduled" || $db.jobs.scheduling_status == "in_progress" || $db.jobs.scheduling_status == "broadcasting" || $db.jobs.scheduling_status == "ready")
              sort = {jobs.scheduled_start: "asc"}
              return = {type: "list", paging: {page: 1, per_page: 50}}
            } as $todays_jobs
          
            var $job_count {
              value = $todays_jobs.items|count
            }
          
            // 3c. Build the SMS body.
            var $body {
              value = ""
            }
          
            conditional {
              if ($job_count == 0) {
                var.update $body {
                  value = "morning. nothing on the books today. ill ping you if anything pops up."
                }
              }
            
              else {
                var.update $body {
                  value = "morning. " ~ ($job_count|to_text) ~ " jobs today.\n"
                }
              
                foreach ($todays_jobs.items) {
                  each as $job {
                    // Customer name + city.
                    db.get customer {
                      field_name = "id"
                      field_value = $job.customer_id
                    } as $customer
                  
                    var $cust_first {
                      value = (($customer.first_name ?? "")|to_lower)
                    }
                  
                    var $cust_last {
                      value = (($customer.last_name ?? "")|to_lower)
                    }
                  
                    var $city {
                      value = (($job.service_city ?? "")|to_lower)
                    }
                  
                    // Time in CT, formatted "9am" / "1:30pm" — no leading zero, drop :00, lowercase.
                    var $job_ct_ts {
                      value = $job.scheduled_start|transform_timestamp:"-5 hours"
                    }
                  
                    var $hour_24 {
                      value = ($job_ct_ts|format_timestamp:"H")|to_int
                    }
                  
                    var $minute_str {
                      value = $job_ct_ts|format_timestamp:"i"
                    }
                  
                    var $am_pm {
                      value = $job_ct_ts|format_timestamp:"a"
                    }
                  
                    var $hour_12 {
                      value = ($hour_24 == 0) ? 12 : (($hour_24 > 12) ? ($hour_24 - 12) : $hour_24)
                    }
                  
                    var $time_str {
                      value = ($minute_str == "00") ? (($hour_12|to_text) ~ $am_pm) : (($hour_12|to_text) ~ ":" ~ $minute_str ~ $am_pm)
                    }
                  
                    // Appliance descriptor.
                    var $brand_lower {
                      value = (($job.brand ?? "")|to_lower)
                    }
                  
                    var $appl_lower {
                      value = (($job.appliance_type ?? "")|to_lower)
                    }
                  
                    var $problem {
                      value = (($job.problem_summary ?? "")|to_lower)
                    }
                  
                    var $line1 {
                      value = $time_str ~ " - " ~ $cust_first ~ " " ~ $cust_last ~ ", " ~ $city ~ " - " ~ $brand_lower ~ " " ~ $appl_lower ~ " " ~ $problem
                    }
                  
                    // Second line: parts status + model. Built via nested conditionals
                    // (XanoScript has no `else if`, so we nest).
                    var $parts {
                      value = (($job.parts_status ?? "")|trim)
                    }
                  
                    var $model {
                      value = (($job.model_number ?? "")|trim)
                    }
                  
                    var $line2 {
                      value = ""
                    }
                  
                    conditional {
                      if (($parts != "") && ($model != "")) {
                        var.update $line2 {
                          value = "       (" ~ $parts ~ ", model " ~ $model ~ ")"
                        }
                      }
                    
                      else {
                        conditional {
                          if ($parts != "") {
                            var.update $line2 {
                              value = "       (" ~ $parts ~ ")"
                            }
                          }
                        
                          else {
                            conditional {
                              if ($model != "") {
                                var.update $line2 {
                                  value = "       (model " ~ $model ~ ")"
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  
                    var $line2_with_break {
                      value = ($line2 != "") ? ("\n" ~ $line2) : ""
                    }
                  
                    var.update $body {
                      value = $body ~ "\n" ~ $line1 ~ $line2_with_break
                    }
                  }
                }
              }
            }
          
            // 3d. Send via Twilio (clean env-var pattern from process_feedback_queue).
            //     From = +17273508487 (the new tech line); To = "+1" + tech.phone (10-digit).
            // ── SMS_ENABLED gate (call_site: daily_tech_summary.xs:224) ──
            var $gate224_recipient_e164 {
              value = "+1" ~ $tech.phone
            }
          
            var $gate224_is_owner {
              value = ($gate224_recipient_e164 == "+16154855795") || ($tech.phone == "6154855795")
            }
          
            var $gate224_sms_enabled {
              value = (($env.SMS_ENABLED ?? "false") == "true")
            }
          
            var $gate224_should_send {
              value = $gate224_sms_enabled || $gate224_is_owner
            }
          
            conditional {
              if ($gate224_should_send == false) {
                db.add event_log {
                  data = {
                    action  : "sms_gated"
                    metadata: {
                    recipient   : $gate224_recipient_e164
                    body_preview: $body|substr:0:200
                    gated_reason: "SMS_ENABLED=false, non-owner recipient"
                    call_site   : "daily_tech_summary.xs:224"
                    tech_id     : $tech.id
                    job_count   : $job_count
                  }
                  }
                } as $gate224_log
              }
            
              else {
                conditional {
                  if ($gate224_is_owner && $gate224_sms_enabled == false) {
                    db.add event_log {
                      data = {
                        action  : "sms_owner_bypass"
                        metadata: {
                        recipient   : $gate224_recipient_e164
                        body_preview: $body|substr:0:200
                        call_site   : "daily_tech_summary.xs:224"
                        tech_id     : $tech.id
                        job_count   : $job_count
                      }
                      }
                    } as $bypass224_log
                  }
                }
              
                api.request {
                  url = "https://api.telnyx.com/v2/messages"
                  method = "POST"
                  params = {
                    from: $env.TELNYX_FROM_TECH
                    to  : "+1" ~ $tech.phone
                    text: $body
                  }
                
                  headers = [
                    "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                    "Content-Type: application/json"
                  ]
                } as $twilio_response
              
                var $twilio_sid {
                  value = $twilio_response.response.result.sid ?? ""
                }
              
                var $twilio_ok {
                  value = ($twilio_response.response.status >= 200) && ($twilio_response.response.status < 300)
                }
              
                // 3e. Log the send.
                db.add daily_summary_log {
                  data = {
                    tech_id      : $tech.id
                    sent_for_date: $today_ct_date
                    sent_at      : now
                    job_count    : $job_count
                    sms_success  : $twilio_ok
                    twilio_sid   : $twilio_sid
                  }
                } as $log_row
              
                debug.log {
                  value = "daily summary sent: tech_id=" ~ ($tech.id|to_text) ~ " jobs=" ~ ($job_count|to_text) ~ " sid=" ~ $twilio_sid
                }
              }
            }
          }
        }
      }
    }
  }

  schedule = [{starts_on: 2026-05-03 00:00:00+0000, freq: 900}]
  guid = "DlyTechSummary_v1_xj4kpQ8mYr"
}