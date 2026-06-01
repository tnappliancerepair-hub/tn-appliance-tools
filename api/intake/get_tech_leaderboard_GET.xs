// Returns per-tech leaderboard for the current month.
// Counts: jobs_completed, jobs_started, total_earnings (sum of all 3 commission types).
query get_tech_leaderboard verb=GET {
  api_group = "intake"

  input {
    int? month_offset?
  }

  stack {
    var $offset {
      value = ($input.month_offset ?? 0)
    }
  
    // Month start in CT — "first of this month + offset months"
    var $now_ct {
      value = now|transform_timestamp:"-5 hours"
    }
  
    var $year {
      value = $now_ct|format_timestamp:"Y"
    }
  
    var $month_num {
      value = ($now_ct|format_timestamp:"m")|to_int
    }
  
    var $effective_month {
      value = $month_num + $offset
    }
  
    var $effective_year {
      value = $year|to_int
    }
  
    // Wrap month overflow
    conditional {
      if ($effective_month < 1) {
        var.update $effective_month {
          value = $effective_month + 12
        }
      
        var.update $effective_year {
          value = $effective_year - 1
        }
      }
    
      elseif ($effective_month > 12) {
        var.update $effective_month {
          value = $effective_month - 12
        }
      
        var.update $effective_year {
          value = $effective_year + 1
        }
      }
    }
  
    var $month_str {
      value = ($effective_month < 10 ? ("0" ~ ($effective_month|to_text)) : ($effective_month|to_text))
    }
  
    var $month_start_local {
      value = ($effective_year|to_text) ~ "-" ~ $month_str ~ "-01 00:00:00"
    }
  
    var $month_start_utc {
      value = ($month_start_local|to_timestamp)|transform_timestamp:"+5 hours"
    }
  
    var $month_end_utc {
      value = $month_start_utc|transform_timestamp:"+1 month"
    }
  
    var $month_label {
      value = $month_start_utc|format_timestamp:"F Y"
    }
  
    // Pull all active techs
    db.query technicians {
      where = $db.technicians.active == true && $db.technicians.id != 8
      sort = {technicians.id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $tech_rows
  
    var $leaderboard {
      value = []
    }
  
    foreach ($tech_rows.items) {
      each as $tech {
        // Completed jobs this month
        db.query jobs {
          where = $db.jobs.technician_id == $tech.id && $db.jobs.scheduling_status == "completed" && $db.jobs.job_completed_at != null && $db.jobs.job_completed_at >= $month_start_utc && $db.jobs.job_completed_at < $month_end_utc
          return = {type: "count"}
        } as $completed_count
      
        // Started jobs this month
        db.query jobs {
          where = $db.jobs.technician_id == $tech.id && $db.jobs.job_started_at != null && $db.jobs.job_started_at >= $month_start_utc && $db.jobs.job_started_at < $month_end_utc
          return = {type: "count"}
        } as $started_count
      
        // Earnings this month
        db.query tech_earnings {
          where = $db.tech_earnings.tech_id == $tech.id && $db.tech_earnings.earned_at != null && $db.tech_earnings.earned_at >= $month_start_utc && $db.tech_earnings.earned_at < $month_end_utc
          return = {type: "list", paging: {page: 1, per_page: 500}}
        } as $earn_rows
      
        var $earn_total {
          value = 0
        }
      
        foreach ($earn_rows.items) {
          each as $e {
            var $row_total {
              value = ($e.commission_earned ?? 0) + ($e.addon_commission ?? 0) + ($e.parts_markup ?? 0)
            }
          
            var.update $earn_total {
              value = $earn_total + $row_total
            }
          }
        }
      
        var $entry {
          value = {
            tech_id       : $tech.id
            first_name    : ($tech.first_name ?? "")
            last_name     : ($tech.last_name ?? "")
            jobs_completed: ($completed_count ?? 0)
            jobs_started  : ($started_count ?? 0)
            earnings_total: $earn_total
          }
        }
      
        var.update $leaderboard {
          value = $leaderboard|push:$entry
        }
      }
    }
  }

  response = {
    success     : true
    month_label : $month_label
    month_offset: $offset
    tech_count  : $leaderboard|count
    leaderboard : $leaderboard
  }

  guid = "get-tech-leaderboard-v1"
}