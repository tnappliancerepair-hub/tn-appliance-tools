// Returns the next job scheduled for a tech today, AFTER the given
// current_job_id's scheduled_start. Used by tech-ant-live's On My Way
// ETA calculation: drive time from current job address -> next job
// address determines the customer's promised arrival window.
//
// Returns null job when this is the tech's last job of the day (in which
// case the On My Way flow can fall back to a constant 25-minute estimate).
query get_next_tech_job verb=GET {
  api_group = "intake"

  input {
    int tech_id
    int current_job_id
  }

  stack {
    precondition ($input.tech_id != null && $input.tech_id > 0) {
      error_type = "inputerror"
      error      = "tech_id is required"
    }

    precondition ($input.current_job_id != null && $input.current_job_id > 0) {
      error_type = "inputerror"
      error      = "current_job_id is required"
    }

    db.get jobs {
      field_name  = "id"
      field_value = $input.current_job_id
    } as $current_job

    precondition ($current_job != null) {
      error_type = "notfound"
      error      = "current_job not found"
    }

    var $cur_start {
      value = ($current_job.scheduled_start ?? 0)
    }

    // End-of-today boundary in unix ms (America/Chicago is approximated by
    // server-side timestamp window: jobs scheduled within 18 hours of the
    // current job's start counts as "today" for the typical 8a-8p workday).
    var $today_end_ms {
      value = ($cur_start + 64800000)
    }

    db.query jobs {
      where  = $db.jobs.technician_id == $input.tech_id && $db.jobs.id != $input.current_job_id && $db.jobs.scheduled_start > $cur_start && $db.jobs.scheduled_start <= $today_end_ms
      sort   = {jobs.scheduled_start: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $next_job {
      value = (($rows.items|first) ?? null)
    }

    var $next_customer { value = null }

    conditional {
      if ($next_job != null && $next_job.customer_id != null && $next_job.customer_id > 0) {
        db.get customer {
          field_name  = "id"
          field_value = $next_job.customer_id
        } as $next_customer
      }
    }

    db.get technicians {
      field_name  = "id"
      field_value = $input.tech_id
    } as $tech_record

    var $tool_pack_minutes {
      value = ($tech_record.tool_pack_minutes ?? 8)
    }

    var $next_address {
      value = null
    }

    conditional {
      if ($next_job != null) {
        var $svc_addr_clean {
          value = (($next_job.service_address ?? "")|trim)
        }

        var $svc_city_clean {
          value = (($next_job.service_city ?? "")|trim)
        }

        var $svc_state_clean {
          value = (($next_job.service_state ?? "")|trim)
        }

        var $svc_zip_clean {
          value = (($next_job.service_zip ?? "")|trim)
        }

        var $cust_addr_clean {
          value = (($next_customer.address ?? "")|trim)
        }

        var $cust_city_clean {
          value = (($next_customer.city ?? "")|trim)
        }

        var $cust_state_clean {
          value = (($next_customer.state ?? "")|trim)
        }

        var $cust_zip_clean {
          value = (($next_customer.zip ?? "")|trim)
        }

        var $use_svc {
          value = ($svc_addr_clean != "")
        }

        var $addr_final {
          value = $use_svc ? $svc_addr_clean : $cust_addr_clean
        }

        var $city_final {
          value = $use_svc ? $svc_city_clean : $cust_city_clean
        }

        var $state_final {
          value = $use_svc ? $svc_state_clean : $cust_state_clean
        }

        var $zip_final {
          value = $use_svc ? $svc_zip_clean : $cust_zip_clean
        }

        var.update $next_address {
          value = {
            address: $addr_final
            city   : $city_final
            state  : $state_final
            zip    : $zip_final
          }
        }
      }
    }
  }

  response = {
    success           : true
    has_next_job      : ($next_job != null)
    next_job_id       : ($next_job.id ?? null)
    scheduled_start   : ($next_job.scheduled_start ?? null)
    appliance_type    : ($next_job.appliance_type ?? "")
    next_address      : $next_address
    tool_pack_minutes : $tool_pack_minutes
  }

  guid = "get-next-tech-job-v1"
}
