// Step 11 — per-tech Tech Assist stats for today's EOD report.
// Counts sessions started, TDRs saved cleanly (via tech_sms_tdr_saved
// event_log), and probable loops (sessions with >5 tdr_write_from_sms
// events without a saved row).
query get_tech_assist_eod_stats verb=GET {
  api_group = "intake"

  input {
    int technician_id
  }

  stack {
    var $now_ms {
      value = now|to_ms
    }
  
    var $today_start_ms {
      value = $now_ms - (16 * 3600 * 1000)
    }
  
    // Sessions created today for this tech
    db.query tech_assist_session {
      where = $db.tech_assist_session.technician_id == $input.technician_id && $db.tech_assist_session.created_at >= $today_start_ms
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $sess_rows
  
    var $sessions_today {
      value = $sess_rows.items|count
    }
  
    // TDRs saved via SMS path today
    db.query event_log {
      where = $db.event_log.action == "tech_sms_tdr_saved" && $db.event_log.created_at >= $today_start_ms
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $saved_rows
  
    var $tech_marker {
      value = "\"tech_id\":" ~ ($input.technician_id|to_text)
    }
  
    var $saved_today {
      value = 0
    }
  
    foreach ($saved_rows.items) {
      each as $sv {
        var $meta_raw {
          value = ($sv.metadata ?? "")
        }
      
        var $strip {
          value = $meta_raw|replace:$tech_marker:""
        }
      
        conditional {
          if (($meta_raw|strlen) > ($strip|strlen)) {
            var.update $saved_today {
              value = $saved_today + 1
            }
          }
        }
      }
    }
  
    // Loop alerts fired today (from tech_assist_loop_alert event_log)
    db.query event_log {
      where = $db.event_log.action == "tech_assist_loop_alert" && $db.event_log.created_at >= $today_start_ms
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $loop_rows
  
    var $loops_today {
      value = 0
    }
  
    foreach ($loop_rows.items) {
      each as $lp {
        var $lp_meta {
          value = ($lp.metadata ?? "")
        }
      
        var $lp_strip {
          value = $lp_meta|replace:$tech_marker:""
        }
      
        conditional {
          if (($lp_meta|strlen) > ($lp_strip|strlen)) {
            var.update $loops_today {
              value = $loops_today + 1
            }
          }
        }
      }
    }
  
    // Pause state (most recent pause/resume for this tech)
    db.query event_log {
      where = $db.event_log.action == "tech_assist_paused" || $db.event_log.action == "tech_assist_resumed"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $pause_rows
  
    var $is_paused {
      value = false
    }
  
    var $found_state {
      value = ""
    }
  
    foreach ($pause_rows.items) {
      each as $pr {
        conditional {
          if ($found_state == "") {
            var $pr_meta {
              value = ($pr.metadata ?? "")
            }
          
            var $pr_strip {
              value = $pr_meta|replace:$tech_marker:""
            }
          
            conditional {
              if (($pr_meta|strlen) > ($pr_strip|strlen)) {
                var.update $found_state {
                  value = ($pr.action ?? "")
                }
              }
            }
          }
        }
      }
    }
  
    conditional {
      if ($found_state == "tech_assist_paused") {
        var.update $is_paused {
          value = true
        }
      }
    }
  }

  response = {
    success      : true
    technician_id: $input.technician_id
    sessions     : $sessions_today
    saved        : $saved_today
    loops        : $loops_today
    is_paused    : $is_paused
  }

  guid = "get-tech-assist-eod-stats-v1"
}