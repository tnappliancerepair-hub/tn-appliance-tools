query get_tech_daily_dashboard verb=GET {
  api_group = "intake"

  input {
    int tech_id
    text? date?
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
  
    var $date_in {
      value = ($input.date ?? "")|trim
    }
  
    var $now_ct_ts {
      value = now|transform_timestamp:"-5 hours"
    }
  
    var $today_ct_str {
      value = $now_ct_ts|format_timestamp:"Y-m-d"
    }
  
    var $resolved_date {
      value = ($date_in != "") ? $date_in : $today_ct_str
    }
  
    var $day_start_utc {
      value = (($resolved_date ~ " 00:00:00")|to_timestamp)|transform_timestamp:"+5 hours"
    }
  
    var $day_end_utc {
      value = $day_start_utc|transform_timestamp:"+1 day"
    }
  
    db.query jobs {
      where = $db.jobs.technician_id == $input.tech_id && $db.jobs.scheduled_start >= $day_start_utc && $db.jobs.scheduled_start < $day_end_utc && $db.jobs.scheduling_status != "canceled"
      sort = {jobs.scheduled_start: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $job_rows
  
    var $jobs_out {
      value = []
    }
  
    foreach ($job_rows.items) {
      each as $job {
        var $customer {
          value = null
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
          
            var.update $customer {
              value = $cust_lookup
            }
          }
        }
      
        db.query technician_decision_report {
          where = $db.technician_decision_report.job_id == $job.id && $db.technician_decision_report.technician_id == 1
          sort = {technician_decision_report.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $teddy_tdr_rows
      
        var $teddy_tdr {
          value = (($teddy_tdr_rows.items|first) ?? null)
        }
      
        // Latest TDR for this job by ANY tech (so the on-site tech sees
        // their own submitted TDR back on the dashboard for confirmation).
        db.query technician_decision_report {
          where = $db.technician_decision_report.job_id == $job.id
          sort = {technician_decision_report.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $latest_tdr_rows
      
        var $latest_tdr {
          value = (($latest_tdr_rows.items|first) ?? null)
        }
      
        db.query job_attachments {
          where = $db.job_attachments.job_id == $job.id && $db.job_attachments.upload_complete_at != null
          sort = {job_attachments.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 6}}
        } as $att_preview_rows
      
        db.query job_attachments {
          where = $db.job_attachments.job_id == $job.id && $db.job_attachments.upload_complete_at != null
          return = {type: "count"}
        } as $att_count
      
        var $job_item {
          value = {
            job                : $job
            customer           : $customer
            teddy_pre_diagnosis: $teddy_tdr
            latest_tdr         : $latest_tdr
            attachments_count  : $att_count
            attachments_preview: $att_preview_rows.items
          }
        }
      
        var.update $jobs_out {
          value = $jobs_out|push:$job_item
        }
      }
    }
  
    // Personal block / day-off lookup so the dashboard can banner
    // "HAS ALEC" / "vacation" / etc. above the day's jobs.
    db.query tech_availability {
      where = $db.tech_availability.technician_id == $tech.id && $db.tech_availability.blocked_date == $resolved_date
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $avail_rows
  
    var $day_off_reason {
      value = ""
    }
  
    var $day_off_active {
      value = false
    }
  
    foreach ($avail_rows.items) {
      each as $a {
        conditional {
          if (($a.full_day_off ?? false)) {
            var.update $day_off_active {
              value = true
            }
          
            var.update $day_off_reason {
              value = ($a.reason ?? "")
            }
          }
        }
      }
    }
  }

  response = {
    success             : true
    tech                : $tech
    date_ct             : $resolved_date
    today_ct            : $today_ct_str
    date_window_start_ms: $day_start_utc
    date_window_end_ms  : $day_end_utc
    job_count           : $jobs_out|count
    jobs                : $jobs_out
    day_off_active      : $day_off_active
    day_off_reason      : $day_off_reason
  }

  guid = "get-tech-daily-dashboard-v1"
}