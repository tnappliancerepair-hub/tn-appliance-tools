query get_office_calendar_week verb=GET {
  api_group = "intake"

  input {
    text? week_start?
  }

  stack {
    var $week_start_in {
      value = ($input.week_start ?? "")|trim
    }

    var $now_ct_ts {
      value = now|transform_timestamp:"-5 hours"
    }

    var $today_ct_str {
      value = $now_ct_ts|format_timestamp:"Y-m-d"
    }

    var $resolved_week_start {
      value = ""
    }

    conditional {
      if ($week_start_in != "") {
        var.update $resolved_week_start {
          value = $week_start_in
        }
      }

      else {
        var $today_dow_iso {
          value = ($now_ct_ts|format_timestamp:"N")|to_int
        }

        var $days_back_to_mon {
          value = $today_dow_iso - 1
        }

        var $monday_ts {
          value = $now_ct_ts|transform_timestamp:"-" ~ ($days_back_to_mon|to_text) ~ " days"
        }

        var.update $resolved_week_start {
          value = $monday_ts|format_timestamp:"Y-m-d"
        }
      }
    }

    var $week_start_utc {
      value = (($resolved_week_start ~ " 00:00:00")|to_timestamp)|transform_timestamp:"+5 hours"
    }

    var $week_end_utc {
      value = $week_start_utc|transform_timestamp:"+7 days"
    }

    var $sunday_str {
      value = $week_start_utc|transform_timestamp:"+6 days"|format_timestamp:"Y-m-d"
    }

    db.query technicians {
      where = $db.technicians.active == true
      sort = {technicians.id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $tech_rows

    var $technicians_out {
      value = []
    }

    foreach ($tech_rows.items) {
      each as $t {
        var $t_first {
          value = ($t.first_name ?? "")|trim
        }

        conditional {
          if ($t_first != "") {
            var $tech_entry {
              value = {
                id        : $t.id
                first_name: ($t.first_name ?? "")
                last_name : ($t.last_name ?? "")
                phone     : ($t.phone ?? "")
              }
            }

            var.update $technicians_out {
              value = $technicians_out|push:$tech_entry
            }
          }
        }
      }
    }

    db.query jobs {
      where = $db.jobs.scheduled_start >= $week_start_utc && $db.jobs.scheduled_start < $week_end_utc && $db.jobs.scheduling_status != "canceled"
      sort = {jobs.scheduled_start: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $job_rows

    var $jobs_out {
      value = []
    }

    foreach ($job_rows.items) {
      each as $j {
        var $cust_id_val {
          value = ($j.customer_id ?? 0)
        }

        var $cust_first {
          value = ""
        }

        var $cust_last {
          value = ""
        }

        var $cust_phone {
          value = ""
        }

        conditional {
          if ($cust_id_val > 0) {
            db.get customer {
              field_name = "id"
              field_value = $cust_id_val
            } as $c

            var.update $cust_first {
              value = ($c.first_name ?? "")
            }

            var.update $cust_last {
              value = ($c.last_name ?? "")
            }

            var.update $cust_phone {
              value = ($c.phone ?? "")
            }
          }
        }

        var $job_entry {
          value = {
            id                 : $j.id
            scheduled_start    : $j.scheduled_start
            scheduled_end      : ($j.scheduled_end ?? null)
            technician_id      : ($j.technician_id ?? 0)
            appliance_type     : ($j.appliance_type ?? "")
            brand              : ($j.brand ?? "")
            model_number       : ($j.model_number ?? "")
            problem_summary    : ($j.problem_summary ?? "")
            service_city       : ($j.service_city ?? "")
            service_address    : ($j.service_address ?? "")
            current_status     : ($j.current_status ?? "")
            scheduling_status  : ($j.scheduling_status ?? "")
            customer_type      : ($j.customer_type ?? "")
            warranty_company   : ($j.warranty_company ?? "")
            claim_number       : ($j.claim_number ?? "")
            customer_first_name: $cust_first
            customer_last_name : $cust_last
            customer_phone     : $cust_phone
          }
        }

        var.update $jobs_out {
          value = $jobs_out|push:$job_entry
        }
      }
    }

    db.query tech_availability {
      where = $db.tech_availability.blocked_date >= $resolved_week_start && $db.tech_availability.blocked_date <= $sunday_str
      sort = {tech_availability.blocked_date: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $avail_rows
  }

  response = {
    success      : true
    week_start_ct: $resolved_week_start
    week_end_ct  : $sunday_str
    week_start_ms: $week_start_utc
    week_end_ms  : $week_end_utc
    today_ct     : $today_ct_str
    technicians  : $technicians_out
    jobs         : $jobs_out
    availability : $avail_rows.items
  }

  guid = "get-office-calendar-week-v1"
}
