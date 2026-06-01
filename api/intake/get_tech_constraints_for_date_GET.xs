//  Returns scheduling constraints for a tech on a specific date.
//  Auto-book queries this before slotting a job so it never lands on
//  a day-off or outside the tech's working window.
// 
//  Precedence for working window (first non-null wins):
//    1. tech_availability row for (tech, date) — most recent
//       → if full_day_off=true, short-circuit with day-off response
//    2. technicians.preferred_hours_start/end — the tech's default
//    3. system default 08:00 / 16:00
// 
//  Existing job count: queries jobs where technician_id matches AND
//  scheduled_start is within the day window AND status not canceled.
//  Used by auto-book to skip dates where tech is already at capacity.
query get_tech_constraints_for_date verb=GET {
  api_group = "intake"

  input {
    int technician_id
    text date_ymd
    int day_start_ms
    int day_end_ms
  
    // Day-of-week name in lowercase (monday..sunday). Caller computes
    // this from date_ymd. Used to match against tech_preferences hard
    // weekly day-off rules captured via SMS shortcut.
    text? day_of_week_lower?
  }

  stack {
    precondition ($input.technician_id > 0 && $input.day_start_ms > 0 && $input.day_end_ms > $input.day_start_ms) {
      error_type = "inputerror"
      error = "technician_id, day_start_ms, day_end_ms required"
    }
  
    // 1. Load tech profile defaults
    db.get technicians {
      field_name = "id"
      field_value = $input.technician_id
    } as $tech
  
    precondition ($tech != null) {
      error_type = "notfound"
      error = "Tech not found"
    }
  
    // 2. Load most-recent tech_availability row for (tech, date)
    db.query tech_availability {
      where = $db.tech_availability.technician_id == $input.technician_id && $db.tech_availability.blocked_date == $input.date_ymd
      sort = {tech_availability.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $avail_rows
  
    var $avail_row {
      value = (($avail_rows.items|first) ?? null)
    }
  
    // Short-circuit if explicit day-off
    var $is_day_off {
      value = ($avail_row != null) && ($avail_row.full_day_off == true)
    }
  
    // 3. Pick working window — avail row first, then tech default, then system
    var $tech_start {
      value = (($tech.preferred_hours_start ?? "")|trim)
    }
  
    var $tech_end {
      value = (($tech.preferred_hours_end ?? "")|trim)
    }
  
    var $avail_start {
      value = (($avail_row.start_time ?? "")|trim)
    }
  
    var $avail_end {
      value = (($avail_row.end_time ?? "")|trim)
    }
  
    var $window_source {
      value = "system_default"
    }
  
    var $window_start {
      value = "08:00"
    }
  
    var $window_end {
      value = "16:00"
    }
  
    conditional {
      if ($avail_start != "" && $avail_end != "") {
        var.update $window_start {
          value = $avail_start
        }
      
        var.update $window_end {
          value = $avail_end
        }
      
        var.update $window_source {
          value = "tech_availability"
        }
      }
    
      elseif ($tech_start != "" && $tech_end != "") {
        var.update $window_start {
          value = $tech_start
        }
      
        var.update $window_end {
          value = $tech_end
        }
      
        var.update $window_source {
          value = "tech_default"
        }
      }
    }
  
    // 4. Count already-scheduled jobs for tech on this date (not canceled)
    db.query jobs {
      where = $db.jobs.technician_id == $input.technician_id && $db.jobs.scheduled_start >= $input.day_start_ms && $db.jobs.scheduled_start < $input.day_end_ms && $db.jobs.scheduling_status != "canceled" && $db.jobs.scheduling_status != "no_fix_possible"
      sort = {jobs.scheduled_start: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $existing_rows
  
    var $existing_count {
      value = $existing_rows.items|count
    }
  
    // 5. tech_preferences: hard day-of-week off (SMS-captured "OFF SAT" etc)
    var $dow_lower {
      value = (($input.day_of_week_lower ?? "")|trim|lower)
    }
  
    var $hard_day_off_from_pref {
      value = false
    }
  
    conditional {
      if ($dow_lower != "" && !$is_day_off) {
        db.query tech_preferences {
          where = $db.tech_preferences.tech_id == $input.technician_id && $db.tech_preferences.active == true && $db.tech_preferences.preference_type == "time" && $db.tech_preferences.day_of_week == $dow_lower && $db.tech_preferences.strength == "hard"
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $dow_pref_rows
      
        var $dow_pref_first {
          value = (($dow_pref_rows.items|first) ?? null)
        }
      
        conditional {
          if ($dow_pref_first != null) {
            var.update $hard_day_off_from_pref {
              value = true
            }
          }
        }
      }
    }
  
    var $final_day_off {
      value = $is_day_off || $hard_day_off_from_pref
    }
  
    var $final_day_off_reason {
      value = $is_day_off ? ($avail_row.reason ?? "tech_availability_full_day_off") : ($hard_day_off_from_pref ? "tech_preference_weekly_day_off" : "")
    }
  
    // 6. tech_preferences: max_jobs_per_day (captured via SMS "MAX 5")
    // Latest active row wins. Notes format: "max_jobs:N".
    db.query tech_preferences {
      where = $db.tech_preferences.tech_id == $input.technician_id && $db.tech_preferences.active == true && $db.tech_preferences.preference_type == "time" && $db.tech_preferences.day_of_week == null
      sort = {tech_preferences.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 20}}
    } as $time_pref_rows
  
    var $max_jobs {
      value = 6
    }
  
    foreach ($time_pref_rows.items) {
      each as $pref_row {
        var $notes_val {
          value = (($pref_row.notes ?? "")|trim)
        }
      
        conditional {
          if (($notes_val|substr:0:9) == "max_jobs:" && $max_jobs == 6) {
            var $maxstr {
              value = $notes_val|substr:9
            }
          
            var $maxnum {
              value = $maxstr|to_int
            }
          
            conditional {
              if ($maxnum >= 1 && $maxnum <= 12) {
                var.update $max_jobs {
                  value = $maxnum
                }
              }
            }
          }
        }
      }
    }
  }

  response = {
    success           : true
    technician_id     : $input.technician_id
    date_ymd          : $input.date_ymd
    full_day_off      : $final_day_off
    day_off_reason    : $final_day_off_reason
    working_start     : $window_start
    working_end       : $window_end
    window_source     : $window_source
    existing_job_count: $existing_count
    max_jobs_per_day  : $max_jobs
    tech_first_name   : ($tech.first_name ?? "")
  }

  guid = "get-tech-constraints-for-date-v1"
}