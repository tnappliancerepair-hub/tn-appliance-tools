// Returns techs with at least one job completed today (CT) where the
// tech's TDR is missing or incomplete. Drives the daily 4pm TDR reminder.
//
// "Incomplete" = TDR has fewer than 5 of these fields populated:
//   diagnosis (non-empty), failure_cause (non-empty),
//   failed_component (non-empty), repair_completed (non-empty),
//   labor_time_hours (> 0).
query get_techs_with_open_tdr verb=GET {
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

    var $day_start_utc {
      value = (($today_resolved ~ " 00:00:00")|to_timestamp)|transform_timestamp:"+5 hours"
    }

    var $day_end_utc {
      value = $day_start_utc|transform_timestamp:"+1 day"
    }

    // Pull terminal jobs completed today
    db.query jobs {
      where = $db.jobs.job_completed_at != null && $db.jobs.job_completed_at >= $day_start_utc && $db.jobs.job_completed_at < $day_end_utc
      sort = {jobs.job_completed_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $job_rows

    // Map tech_id -> {tech_first, jobs[{job_id, customer_first, appliance, scheduling_status}]}
    var $tech_buckets {
      value = {}
    }

    foreach ($job_rows.items) {
      each as $job {
        var $tech_id_val {
          value = ($job.technician_id ?? 0)
        }

        conditional {
          if ($tech_id_val > 0) {
            // Check tech's TDR for this job
            db.query technician_decision_report {
              where = $db.technician_decision_report.job_id == $job.id && $db.technician_decision_report.technician_id == $tech_id_val
              sort = {technician_decision_report.created_at: "desc"}
              return = {type: "list", paging: {page: 1, per_page: 1}}
            } as $tdr_rows

            var $tdr {
              value = (($tdr_rows.items|first) ?? null)
            }

            var $filled {
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
                    var.update $filled { value = $filled + 1 }
                  }
                }

                conditional {
                  if ($fail_t != "") {
                    var.update $filled { value = $filled + 1 }
                  }
                }

                conditional {
                  if ($comp_t != "") {
                    var.update $filled { value = $filled + 1 }
                  }
                }

                conditional {
                  if ($repair_t != "") {
                    var.update $filled { value = $filled + 1 }
                  }
                }

                conditional {
                  if ($labor_v > 0) {
                    var.update $filled { value = $filled + 1 }
                  }
                }
              }
            }

            // Incomplete = filled < 5
            conditional {
              if ($filled < 5) {
                var $cust_first { value = "" }

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

                var $tech_key {
                  value = $tech_id_val|to_text
                }

                var $existing_bucket {
                  value = ($tech_buckets|get:$tech_key) ?? null
                }

                var $existing_jobs {
                  value = ($existing_bucket != null ? $existing_bucket.jobs : [])
                }

                var $new_entry {
                  value = {
                    job_id              : $job.id
                    customer_first_name : $cust_first
                    appliance           : ($job.appliance_type ?? "")
                    brand               : ($job.brand ?? "")
                    scheduling_status   : ($job.scheduling_status ?? "")
                    filled_count        : $filled
                  }
                }

                var $updated_jobs {
                  value = $existing_jobs|push:$new_entry
                }

                var $tech_first_v { value = "" }
                var $tech_phone_v { value = "" }

                conditional {
                  if ($existing_bucket == null) {
                    db.get technicians {
                      field_name = "id"
                      field_value = $tech_id_val
                    } as $tech_full

                    var.update $tech_first_v {
                      value = ($tech_full.first_name ?? "")
                    }
                    var.update $tech_phone_v {
                      value = ($tech_full.phone ?? "")
                    }
                  }

                  else {
                    var.update $tech_first_v {
                      value = ($existing_bucket.tech_first ?? "")
                    }
                    var.update $tech_phone_v {
                      value = ($existing_bucket.tech_phone ?? "")
                    }
                  }
                }

                var $new_bucket {
                  value = {
                    tech_id    : $tech_id_val
                    tech_first : $tech_first_v
                    tech_phone : $tech_phone_v
                    jobs       : $updated_jobs
                  }
                }

                var.update $tech_buckets {
                  value = $tech_buckets|set:$tech_key:$new_bucket
                }
              }
            }
          }
        }
      }
    }

    // Convert map to array for the response
    var $tech_keys {
      value = $tech_buckets|keys
    }

    var $tech_list {
      value = []
    }

    foreach ($tech_keys) {
      each as $k {
        var $bucket {
          value = ($tech_buckets|get:$k)
        }

        var.update $tech_list {
          value = $tech_list|push:$bucket
        }
      }
    }
  }

  response = {
    success    : true
    today_ct   : $today_resolved
    tech_count : ($tech_list|count)
    techs      : $tech_list
  }

  guid = "get-techs-with-open-tdr-v1"
}
