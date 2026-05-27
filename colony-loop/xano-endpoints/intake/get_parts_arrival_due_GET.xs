// Returns jobs in awaiting_parts status with parts_eta_date <= today CT.
// Drives the daily parts-arrival follow-up sweep. Each row carries the
// minimum context the agent needs to compose the SMS + dedup against
// prior follow-ups.
query get_parts_arrival_due verb=GET {
  api_group = "intake"

  input {
    text? today_ct?
  }

  stack {
    var $today_in {
      value = ($input.today_ct ?? "")|trim
    }

    var $now_ct {
      value = now|transform_timestamp:"-5 hours"
    }

    var $today_resolved {
      value = ($today_in != "" ? $today_in : ($now_ct|format_timestamp:"Y-m-d"))
    }

    db.query jobs {
      where = $db.jobs.scheduling_status == "awaiting_parts" && $db.jobs.parts_eta_date != null && $db.jobs.parts_eta_date != "" && $db.jobs.parts_eta_date <= $today_resolved
      sort = {jobs.parts_eta_date: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $job_rows

    var $out {
      value = []
    }

    foreach ($job_rows.items) {
      each as $job {
        var $cust_first { value = "" }
        var $cust_phone { value = "" }

        var $cust_id_val {
          value = ($job.customer_id ?? 0)
        }

        conditional {
          if ($cust_id_val > 0) {
            db.get customer {
              field_name = "id"
              field_value = $cust_id_val
            } as $cust_lookup

            var $first_raw {
              value = ($cust_lookup.first_name ?? "")|trim
            }

            var $phone_raw {
              value = ($cust_lookup.phone ?? "")|trim
            }

            var.update $cust_first {
              value = $first_raw
            }

            var.update $cust_phone {
              value = $phone_raw
            }
          }
        }

        var $item {
          value = {
            job_id          : $job.id
            customer_id     : $cust_id_val
            customer_first  : $cust_first
            customer_phone  : $cust_phone
            appliance_type  : ($job.appliance_type ?? "")
            brand           : ($job.brand ?? "")
            parts_eta_date  : ($job.parts_eta_date ?? "")
            warranty_company: ($job.warranty_company ?? "")
            customer_type   : ($job.customer_type ?? "")
            technician_id   : ($job.technician_id ?? 0)
          }
        }

        var.update $out {
          value = $out|push:$item
        }
      }
    }
  }

  response = {
    success      : true
    today_ct     : $today_resolved
    job_count    : ($out|count)
    jobs         : $out
  }

  guid = "get-parts-arrival-due-v1"
}
