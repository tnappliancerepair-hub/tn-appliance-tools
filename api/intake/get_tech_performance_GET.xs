query get_tech_performance verb=GET {
  api_group = "intake"

  input {
    int tech_id
    text? period?
  }

  stack {
    db.get technicians {
      field_name = "id"
      field_value = $input.tech_id
    } as $tech_full
  
    conditional {
      if ($tech_full == null) {
        return {
          value = {
            success: false
            error  : "tech_not_found"
            tech_id: $input.tech_id
          }
        }
      }
    }
  
    var $tech {
      value = {
        id        : $tech_full.id
        first_name: ($tech_full.first_name ?? "")
        last_name : ($tech_full.last_name ?? "")
        phone     : ($tech_full.phone ?? "")
        active    : ($tech_full.active ?? false)
      }
    }
  
    var $period_in {
      value = ($input.period ?? "week")|trim
    }
  
    var $period_resolved {
      value = ($period_in != "" ? $period_in : "week")
    }
  
    // Pre-bind each period start as a timestamp
    var $start_week_ts {
      value = now|transform_timestamp:"-7 days"
    }
  
    var $start_month_ts {
      value = now|transform_timestamp:"-30 days"
    }
  
    var $start_all_ts {
      value = "1970-01-01 00:00:00"|to_timestamp
    }
  
    var $period_start_ts {
      value = ($period_resolved == "week" ? $start_week_ts : ($period_resolved == "month" ? $start_month_ts : $start_all_ts))
    }
  
    var $period_start_ms {
      value = $period_start_ts|to_ms
    }
  
    var $period_end_ms {
      value = now|to_ms
    }
  
    // Period label parts pre-bound (no filter chains inside ternary)
    var $now_ct {
      value = now|transform_timestamp:"-5 hours"
    }
  
    var $week_label_start {
      value = $start_week_ts|transform_timestamp:"-5 hours"
    }
  
    var $month_label_start {
      value = $start_month_ts|transform_timestamp:"-5 hours"
    }
  
    var $period_label_start_ct {
      value = ($period_resolved == "week" ? $week_label_start : $month_label_start)
    }
  
    var $start_label_str {
      value = $period_label_start_ct|format_timestamp:"M j"
    }
  
    var $end_label_str {
      value = $now_ct|format_timestamp:"M j, Y"
    }
  
    var $window_label {
      value = $start_label_str ~ " - " ~ $end_label_str
    }
  
    var $period_label {
      value = ($period_resolved == "all" ? "All Time" : $window_label)
    }
  
    // Pull terminal jobs in window. Use chained || (in [...] is not proven in XS).
    db.query jobs {
      where = $db.jobs.technician_id == $input.tech_id && ($db.jobs.scheduling_status == "completed" || $db.jobs.scheduling_status == "awaiting_parts" || $db.jobs.scheduling_status == "held" || $db.jobs.scheduling_status == "no_fix_possible") && $db.jobs.job_completed_at != null && $db.jobs.job_completed_at >= $period_start_ts
      sort = {jobs.job_completed_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $job_rows
  
    var $completed_count {
      value = 0
    }
  
    var $awaiting_parts_count {
      value = 0
    }
  
    var $held_count {
      value = 0
    }
  
    var $no_fix_count {
      value = 0
    }
  
    var $total_duration_min {
      value = 0
    }
  
    var $duration_sample_n {
      value = 0
    }
  
    var $tdr_completeness_sum {
      value = 0
    }
  
    var $tdr_sample_n {
      value = 0
    }
  
    var $recent_jobs_out {
      value = []
    }
  
    var $recent_cap {
      value = 15
    }
  
    foreach ($job_rows.items) {
      each as $job {
        var $status {
          value = ($job.scheduling_status ?? "")
        }
      
        conditional {
          if ($status == "completed") {
            var.update $completed_count {
              value = $completed_count + 1
            }
          }
        }
      
        conditional {
          if ($status == "awaiting_parts") {
            var.update $awaiting_parts_count {
              value = $awaiting_parts_count + 1
            }
          }
        }
      
        conditional {
          if ($status == "held") {
            var.update $held_count {
              value = $held_count + 1
            }
          }
        }
      
        conditional {
          if ($status == "no_fix_possible") {
            var.update $no_fix_count {
              value = $no_fix_count + 1
            }
          }
        }
      
        // Duration (minutes) — only when both timestamps present
        var $has_started {
          value = (($job.job_started_at ?? null) != null)
        }
      
        var $has_completed {
          value = (($job.job_completed_at ?? null) != null)
        }
      
        var $started_ms {
          value = ($has_started ? ($job.job_started_at|to_ms) : 0)
        }
      
        var $completed_ms {
          value = ($has_completed ? ($job.job_completed_at|to_ms) : 0)
        }
      
        var $valid_duration {
          value = ($started_ms > 0 && $completed_ms > $started_ms)
        }
      
        var $raw_duration_min {
          value = ($valid_duration ? (($completed_ms - $started_ms) / 60000) : 0)
        }
      
        var $duration_min {
          value = $raw_duration_min|round:0
        }
      
        conditional {
          if ($duration_min > 0) {
            var.update $total_duration_min {
              value = $total_duration_min + $duration_min
            }
          
            var.update $duration_sample_n {
              value = $duration_sample_n + 1
            }
          }
        }
      
        // Tech's own TDR for this job (NOT teddy id=1)
        db.query technician_decision_report {
          where = $db.technician_decision_report.job_id == $job.id && $db.technician_decision_report.technician_id == $input.tech_id
          sort = {technician_decision_report.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $tdr_rows
      
        var $tdr {
          value = (($tdr_rows.items|first) ?? null)
        }
      
        var $tdr_filled {
          value = 0
        }
      
        conditional {
          if ($tdr != null) {
            var $diag_t {
              value = ($tdr.diagnosis ?? "")|trim
            }
          
            var $fail_t {
              value = ($tdr.failure_cause ?? "")|trim
            }
          
            var $comp_t {
              value = ($tdr.failed_component ?? "")|trim
            }
          
            var $repair_t {
              value = ($tdr.repair_completed ?? "")|trim
            }
          
            var $labor_v {
              value = ($tdr.labor_time_hours ?? 0)
            }
          
            conditional {
              if ($diag_t != "") {
                var.update $tdr_filled {
                  value = $tdr_filled + 1
                }
              }
            }
          
            conditional {
              if ($fail_t != "") {
                var.update $tdr_filled {
                  value = $tdr_filled + 1
                }
              }
            }
          
            conditional {
              if ($comp_t != "") {
                var.update $tdr_filled {
                  value = $tdr_filled + 1
                }
              }
            }
          
            conditional {
              if ($repair_t != "") {
                var.update $tdr_filled {
                  value = $tdr_filled + 1
                }
              }
            }
          
            conditional {
              if ($labor_v > 0) {
                var.update $tdr_filled {
                  value = $tdr_filled + 1
                }
              }
            }
          
            var.update $tdr_completeness_sum {
              value = $tdr_completeness_sum + $tdr_filled
            }
          
            var.update $tdr_sample_n {
              value = $tdr_sample_n + 1
            }
          }
        }
      
        // Earnings for THIS job
        db.query tech_earnings {
          where = $db.tech_earnings.job_id == $job.id && $db.tech_earnings.tech_id == $input.tech_id
          sort = {tech_earnings.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $earn_rows
      
        var $earn {
          value = (($earn_rows.items|first) ?? null)
        }
      
        // Customer first name
        var $cust_first {
          value = ""
        }
      
        var $cust_id_val {
          value = ($job.customer_id ?? 0)
        }
      
        conditional {
          if ($cust_id_val > 0) {
            db.get customer {
              field_name = "id"
              field_value = $cust_id_val
            } as $cust_lookup
          
            var $cust_first_raw {
              value = ($cust_lookup.first_name ?? "")|trim
            }
          
            var.update $cust_first {
              value = $cust_first_raw
            }
          }
        }
      
        // Recent-jobs cap
        conditional {
          if (($recent_jobs_out|count) < $recent_cap) {
            var $job_item {
              value = {
                id                 : $job.id
                scheduling_status  : $status
                customer_first_name: $cust_first
                appliance          : ($job.appliance ?? "")
                brand              : ($job.brand ?? "")
                problem_summary    : ($job.problem_summary ?? "")
                job_started_at     : $job.job_started_at
                job_completed_at   : $job.job_completed_at
                duration_minutes   : $duration_min
                has_tdr            : ($tdr != null)
                tdr_filled_count   : $tdr_filled
                earnings           : ($earn ?? null)
              }
            }
          
            var.update $recent_jobs_out {
              value = $recent_jobs_out|push:$job_item
            }
          }
        }
      }
    }
  
    // Earnings totals across the whole period
    db.query tech_earnings {
      where = $db.tech_earnings.tech_id == $input.tech_id && $db.tech_earnings.earned_at != null && $db.tech_earnings.earned_at >= $period_start_ts
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $earn_period
  
    var $earn_total {
      value = 0
    }
  
    var $earn_count {
      value = 0
    }
  
    foreach ($earn_period.items) {
      each as $e {
        var $commission {
          value = ($e.commission_earned ?? 0)
        }
      
        var $addon {
          value = ($e.addon_commission ?? 0)
        }
      
        var $parts {
          value = ($e.parts_markup ?? 0)
        }
      
        var $sum_row {
          value = $commission + $addon + $parts
        }
      
        var.update $earn_total {
          value = $earn_total + $sum_row
        }
      
        var.update $earn_count {
          value = $earn_count + 1
        }
      }
    }
  
    // Derived metrics
    var $total_jobs_for_rate {
      value = $completed_count + $awaiting_parts_count + $held_count
    }
  
    var $first_visit_fix_raw {
      value = ($total_jobs_for_rate > 0 ? ($completed_count / $total_jobs_for_rate) : 0)
    }
  
    var $first_visit_fix_rate {
      value = $first_visit_fix_raw|round:2
    }
  
    var $avg_minutes_raw {
      value = ($duration_sample_n > 0 ? ($total_duration_min / $duration_sample_n) : 0)
    }
  
    var $avg_minutes_per_job {
      value = $avg_minutes_raw|round:0
    }
  
    var $tdr_pct_raw {
      value = ($tdr_sample_n > 0 ? (($tdr_completeness_sum / $tdr_sample_n) / 5) : 0)
    }
  
    var $tdr_completeness_pct {
      value = $tdr_pct_raw|round:2
    }
  
    var $per_job_avg_raw {
      value = ($earn_count > 0 ? ($earn_total / $earn_count) : 0)
    }
  
    var $per_job_avg {
      value = $per_job_avg_raw|round:2
    }
  }

  response = {
    success        : true
    tech           : $tech
    period         : $period_resolved
    period_label   : $period_label
    period_start_ms: $period_start_ms
    period_end_ms  : $period_end_ms
    metrics        : ```
      {
        jobs_completed          : $completed_count
        jobs_awaiting_parts     : $awaiting_parts_count
        jobs_held               : $held_count
        jobs_no_fix_possible    : $no_fix_count
        total_terminal_jobs     : ($completed_count + $awaiting_parts_count + $held_count + $no_fix_count)
        first_visit_fix_rate    : $first_visit_fix_rate
        avg_minutes_per_job     : $avg_minutes_per_job
        tdr_completeness_pct    : $tdr_completeness_pct
        earnings_gross          : $earn_total
        earnings_per_job_avg    : $per_job_avg
        earnings_row_count      : $earn_count
      }
      ```
    recent_jobs    : $recent_jobs_out
  }

  guid = "get-tech-performance-v1"
}