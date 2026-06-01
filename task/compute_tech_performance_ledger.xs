//  Phase 7: nightly performance ledger + pattern detection.
//  Runs daily at 04:00 UTC (~23:00 CT during CDT).
// 
//  Test-mode flag: $env.LEDGER_TASK_ENABLED == "true" required to run.
// 
//  For each active tech:
//    1. Compute 30-day rolling counts: offered, accepted, called_off, helped_out, acceptance_rate
//    2. Find-or-create tech_performance_ledger row for (tech_id, today)
//    3. Pattern detection over last 14 days: bucket declines by city / day_of_week / time_window
//    4. If any bucket >= 3 AND tech has no existing matching pref → set pending_pattern_offer
// 
//  After all techs: compute team_avg_acceptance_rate, update each ledger row.
// 
//  Field semantics:
//    called_off_count = broadcast declines + sick days where this tech was sick (bundled)
//    helped_out_count = sick_day_silent_reassign rows where this tech took the redirect
task compute_tech_performance_ledger {
  stack {
    // ────────────────────────────────────────────────────────
    // 0. Test-mode guard.
    // ────────────────────────────────────────────────────────
    conditional {
      if ($env.LEDGER_TASK_ENABLED != "true") {
        debug.log {
          value = "compute_tech_performance_ledger skipped: LEDGER_TASK_ENABLED != 'true'"
        }
      
        return {
          value = null
        }
      }
    }
  
    // ────────────────────────────────────────────────────────
    // 1. Time computations (CT for date strings, UTC ts for filters).
    // ────────────────────────────────────────────────────────
    var $now_ct_ts {
      value = now|transform_timestamp:"-5 hours"
    }
  
    var $today_ct_date {
      value = $now_ct_ts|format_timestamp:"Y-m-d"
    }
  
    var $period_start_ct_date {
      value = ($now_ct_ts|transform_timestamp:"-30 days")|format_timestamp:"Y-m-d"
    }
  
    var $thirty_days_ago_ts {
      value = now|transform_timestamp:"-30 days"
    }
  
    var $fourteen_days_ago_ts {
      value = now|transform_timestamp:"-14 days"
    }
  
    // ────────────────────────────────────────────────────────
    // 2. Pre-pull data shared across techs (one query per resource).
    // ────────────────────────────────────────────────────────
    db.query technicians {
      where = $db.technicians.active == true
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $all_techs
  
    db.query broadcast_attempt {
      where = $db.broadcast_attempt.broadcast_at >= $thirty_days_ago_ts
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $all_broadcasts
  
    db.query event_log {
      where = $db.event_log.created_at >= $thirty_days_ago_ts && ($db.event_log.action == "broadcast_decline" || $db.event_log.action == "sick_day_silent_reassign" || $db.event_log.action == "sick_day_customer_notified")
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $all_events_30d
  
    // For pattern detection: declines only, last 14 days
    db.query event_log {
      where = $db.event_log.action == "broadcast_decline" && $db.event_log.created_at >= $fourteen_days_ago_ts
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $all_declines_14d
  
    // Track for team-avg compute pass
    var $processed_ledger_ids {
      value = []
    }
  
    var $rates_sum {
      value = 0
    }
  
    var $rates_count {
      value = 0
    }
  
    // ────────────────────────────────────────────────────────
    // 3. Foreach tech: compute ledger + detect patterns.
    // ────────────────────────────────────────────────────────
    foreach ($all_techs.items) {
      each as $tech_row {
        // ---- (a) offered_count: broadcasts where tech was in techs_notified ----
        var $offered {
          value = 0
        }
      
        foreach ($all_broadcasts.items) {
          each as $br_off {
            foreach ($br_off.techs_notified) {
              each as $tn_off {
                conditional {
                  if ($tn_off.tech_id == $tech_row.id) {
                    var.update $offered {
                      value = $offered + 1
                    }
                  }
                }
              }
            }
          }
        }
      
        // ---- (b) accepted_count: broadcasts claimed by this tech ----
        var $accepted {
          value = 0
        }
      
        foreach ($all_broadcasts.items) {
          each as $br_acc {
            conditional {
              if ($br_acc.claimed_by_tech_id == $tech_row.id) {
                var.update $accepted {
                  value = $accepted + 1
                }
              }
            }
          }
        }
      
        // ---- (c) called_off_count: declines + sick fallout (this tech was sick) ----
        var $called_off {
          value = 0
        }
      
        foreach ($all_events_30d.items) {
          each as $ev_co {
            conditional {
              if ($ev_co.action == "broadcast_decline" && $ev_co.metadata.tech_id == $tech_row.id) {
                var.update $called_off {
                  value = $called_off + 1
                }
              }
            
              else {
                conditional {
                  if (($ev_co.action == "sick_day_silent_reassign" || $ev_co.action == "sick_day_customer_notified") && $ev_co.metadata.sick_tech_id == $tech_row.id) {
                    var.update $called_off {
                      value = $called_off + 1
                    }
                  }
                }
              }
            }
          }
        }
      
        // ---- (d) helped_out_count: cascaded jobs this tech took ----
        var $helped_out {
          value = 0
        }
      
        foreach ($all_events_30d.items) {
          each as $ev_ho {
            conditional {
              if ($ev_ho.action == "sick_day_silent_reassign" && $ev_ho.metadata.new_tech_id == $tech_row.id) {
                var.update $helped_out {
                  value = $helped_out + 1
                }
              }
            }
          }
        }
      
        // ---- (e) acceptance_rate ----
        var $rate {
          value = 0
        }
      
        conditional {
          if ($offered > 0) {
            var.update $rate {
              value = ($accepted * 100) / $offered
            }
          }
        }
      
        // ---- (f) Find-or-create ledger row for (tech_id, today) ----
        db.query tech_performance_ledger {
          where = $db.tech_performance_ledger.tech_id == $tech_row.id && $db.tech_performance_ledger.period_end == $today_ct_date
          return = {type: "single"}
        } as $existing_ledger
      
        var $ledger_id {
          value = 0
        }
      
        conditional {
          if ($existing_ledger != null) {
            db.edit tech_performance_ledger {
              field_name = "id"
              field_value = $existing_ledger.id
              data = {
                offered_count   : $offered
                accepted_count  : $accepted
                called_off_count: $called_off
                helped_out_count: $helped_out
                acceptance_rate : $rate
                period_start    : $period_start_ct_date
                updated_at      : now
              }
            } as $ledger_updated
          
            var.update $ledger_id {
              value = $existing_ledger.id
            }
          }
        
          else {
            db.add tech_performance_ledger {
              data = {
                tech_id         : $tech_row.id
                period_start    : $period_start_ct_date
                period_end      : $today_ct_date
                offered_count   : $offered
                accepted_count  : $accepted
                called_off_count: $called_off
                helped_out_count: $helped_out
                acceptance_rate : $rate
                updated_at      : now
              }
            } as $ledger_new
          
            var.update $ledger_id {
              value = $ledger_new.id
            }
          }
        }
      
        var.update $processed_ledger_ids {
          value = $processed_ledger_ids|push:$ledger_id
        }
      
        conditional {
          if ($offered > 0) {
            var.update $rates_sum {
              value = $rates_sum + $rate
            }
          
            var.update $rates_count {
              value = $rates_count + 1
            }
          }
        }
      
        // ────────────────────────────────────────────────────
        // (g) Pattern detection — last 14 days of declines.
        // Build array of {city, dow, time_window} contexts, then
        // count buckets and pick highest >= 3.
        // ────────────────────────────────────────────────────
        var $contexts {
          value = []
        }
      
        foreach ($all_declines_14d.items) {
          each as $td {
            conditional {
              if ($td.metadata.tech_id == $tech_row.id) {
                db.get broadcast_attempt {
                  field_name = "id"
                  field_value = $td.metadata.broadcast_id
                } as $td_br
              
                conditional {
                  if ($td_br != null) {
                    db.get jobs {
                      field_name = "id"
                      field_value = $td_br.job_id
                    } as $td_job
                  
                    conditional {
                      if ($td_job != null) {
                        db.get customer {
                          field_name = "id"
                          field_value = $td_job.customer_id
                        } as $td_cust
                      
                        var $td_city {
                          value = (($td_cust.city ?? "")|trim)|to_lower
                        }
                      
                        var $td_dow {
                          value = ""
                        }
                      
                        var $td_time_window {
                          value = ""
                        }
                      
                        conditional {
                          if ($td_job.scheduled_start != null && $td_job.scheduled_start > 0) {
                            var $td_ct_ts {
                              value = $td_job.scheduled_start|transform_timestamp:"-5 hours"
                            }
                          
                            var.update $td_dow {
                              value = ($td_ct_ts|format_timestamp:"l")|to_lower
                            }
                          
                            var $td_hour {
                              value = ($td_ct_ts|format_timestamp:"H")|to_int
                            }
                          
                            conditional {
                              if ($td_hour < 12) {
                                var.update $td_time_window {
                                  value = "morning"
                                }
                              }
                            
                              else {
                                conditional {
                                  if ($td_hour < 16) {
                                    var.update $td_time_window {
                                      value = "afternoon"
                                    }
                                  }
                                
                                  else {
                                    var.update $td_time_window {
                                      value = "evening"
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      
                        var.update $contexts {
                          value = $contexts
                            |push:{city: $td_city, dow: $td_dow, time_window: $td_time_window}
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      
        // Find best bucket via O(N^2) scan across 3 dimensions.
        var $best_dim {
          value = ""
        }
      
        var $best_val {
          value = ""
        }
      
        var $best_count {
          value = 0
        }
      
        // City scan
        foreach ($contexts) {
          each as $c_a {
            conditional {
              if ($c_a.city != "") {
                var $cc_city {
                  value = 0
                }
              
                foreach ($contexts) {
                  each as $c_b {
                    conditional {
                      if ($c_a.city == $c_b.city) {
                        var.update $cc_city {
                          value = $cc_city + 1
                        }
                      }
                    }
                  }
                }
              
                conditional {
                  if ($cc_city >= 3 && $cc_city > $best_count) {
                    var.update $best_dim {
                      value = "city"
                    }
                  
                    var.update $best_val {
                      value = $c_a.city
                    }
                  
                    var.update $best_count {
                      value = $cc_city
                    }
                  }
                }
              }
            }
          }
        }
      
        // Day-of-week scan
        foreach ($contexts) {
          each as $d_a {
            conditional {
              if ($d_a.dow != "") {
                var $cc_dow {
                  value = 0
                }
              
                foreach ($contexts) {
                  each as $d_b {
                    conditional {
                      if ($d_a.dow == $d_b.dow) {
                        var.update $cc_dow {
                          value = $cc_dow + 1
                        }
                      }
                    }
                  }
                }
              
                conditional {
                  if ($cc_dow >= 3 && $cc_dow > $best_count) {
                    var.update $best_dim {
                      value = "day_of_week"
                    }
                  
                    var.update $best_val {
                      value = $d_a.dow
                    }
                  
                    var.update $best_count {
                      value = $cc_dow
                    }
                  }
                }
              }
            }
          }
        }
      
        // Time-window scan
        foreach ($contexts) {
          each as $t_a {
            conditional {
              if ($t_a.time_window != "") {
                var $cc_tw {
                  value = 0
                }
              
                foreach ($contexts) {
                  each as $t_b {
                    conditional {
                      if ($t_a.time_window == $t_b.time_window) {
                        var.update $cc_tw {
                          value = $cc_tw + 1
                        }
                      }
                    }
                  }
                }
              
                conditional {
                  if ($cc_tw >= 3 && $cc_tw > $best_count) {
                    var.update $best_dim {
                      value = "time_window"
                    }
                  
                    var.update $best_val {
                      value = $t_a.time_window
                    }
                  
                    var.update $best_count {
                      value = $cc_tw
                    }
                  }
                }
              }
            }
          }
        }
      
        // Pattern found — verify no matching active pref before flagging.
        conditional {
          if ($best_count >= 3) {
            db.query tech_preferences {
              where = $db.tech_preferences.tech_id == $tech_row.id && $db.tech_preferences.active == true
              return = {type: "list", paging: {page: 1, per_page: 50}}
            } as $existing_prefs
          
            var $has_matching_pref {
              value = false
            }
          
            foreach ($existing_prefs.items) {
              each as $ep {
                conditional {
                  if ($best_dim == "city") {
                    var $ep_zip_lower {
                      value = ($ep.zip_or_area ?? "")|to_lower
                    }
                  
                    conditional {
                      if ($ep_zip_lower == $best_val) {
                        var.update $has_matching_pref {
                          value = true
                        }
                      }
                    }
                  }
                
                  else {
                    // time_window has no direct field-level analog in
                    // tech_preferences; skip the dup guard for that dimension.
                    conditional {
                      if ($best_dim == "day_of_week") {
                        var $ep_dow_lower {
                          value = ($ep.day_of_week ?? "")|to_lower
                        }
                      
                        conditional {
                          if ($ep_dow_lower == $best_val) {
                            var.update $has_matching_pref {
                              value = true
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
              if ($has_matching_pref == false) {
                db.edit technicians {
                  field_name = "id"
                  field_value = $tech_row.id
                  data = {
                    pending_pattern_offer: {
                    dimension  : $best_dim
                    value      : $best_val
                    match_count: $best_count
                    detected_at: now
                  }
                  }
                } as $tech_pattern_set
              }
            }
          }
        }
      }
    }
  
    // ────────────────────────────────────────────────────────
    // 4. Compute team_avg_acceptance_rate, backfill all ledger rows.
    // ────────────────────────────────────────────────────────
    var $team_avg {
      value = 0
    }
  
    conditional {
      if ($rates_count > 0) {
        var.update $team_avg {
          value = $rates_sum / $rates_count
        }
      }
    }
  
    foreach ($processed_ledger_ids) {
      each as $lid {
        db.edit tech_performance_ledger {
          field_name = "id"
          field_value = $lid
          data = {team_avg_acceptance_rate: $team_avg}
        } as $team_avg_set
      }
    }
  
    debug.log {
      value = "compute_tech_performance_ledger: techs=" ~ (($all_techs.items|count)|to_text) ~ " team_avg=" ~ ($team_avg|to_text)
    }
  }

  schedule = [{starts_on: 2026-05-04 04:00:00+0000, freq: 86400}]
  guid = "LedgerTask_v1_pH9zRtKwYj4VnX"
}