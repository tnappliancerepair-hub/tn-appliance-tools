// Returns self-pay jobs completed in the last N days where
// payment_collected is false. Used by the daily unpaid digest agent.
query get_unpaid_self_pay_jobs verb=GET {
  api_group = "intake"

  input {
    int? days_back?
  }

  stack {
    var $days_back_in {
      value = ($input.days_back ?? 14)
    }

    var $window_ms {
      value = $days_back_in * 24 * 60 * 60 * 1000
    }

    var $now_ms {
      value = now|to_ms
    }

    var $cutoff_ms {
      value = $now_ms - $window_ms
    }

    var $cutoff_ts {
      value = ($cutoff_ms / 1000)|to_timestamp
    }

    db.query jobs {
      where  = $db.jobs.scheduling_status == "completed" && $db.jobs.customer_type == "self_pay" && $db.jobs.payment_collected == false && $db.jobs.job_completed_at != null && $db.jobs.job_completed_at >= $cutoff_ts
      sort   = {jobs.job_completed_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $job_rows

    var $out {
      value = []
    }

    var $total_due_approx {
      value = 0
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

        // Days since completion
        var $completed_ms_val {
          value = ($job.job_completed_at|to_ms)
        }

        var $days_since_raw {
          value = ($now_ms - $completed_ms_val) / (24 * 60 * 60 * 1000)
        }

        var $days_since {
          value = $days_since_raw|round:0
        }

        var $item {
          value = {
            job_id           : $job.id
            customer_id      : $cust_id_val
            customer_first   : $cust_first
            customer_phone   : $cust_phone
            appliance_type   : ($job.appliance_type ?? "")
            brand            : ($job.brand ?? "")
            job_completed_at : $job.job_completed_at
            days_since       : $days_since
            technician_id    : ($job.technician_id ?? 0)
          }
        }

        var.update $out {
          value = $out|push:$item
        }
      }
    }
  }

  response = {
    success    : true
    days_back  : $days_back_in
    job_count  : ($out|count)
    jobs       : $out
  }

  guid = "get-unpaid-self-pay-jobs-v1"
}
