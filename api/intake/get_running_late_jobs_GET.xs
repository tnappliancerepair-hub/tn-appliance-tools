// Returns jobs where scheduled_start is in the past N minutes AND
// no tech-arrival progress (job_started_at + tech_en_route_at both null).
//
// Used by tech_running_late_scan.js (colony loop agent, fires every
// 30 min during business hours) to identify customers who deserve a
// proactive "tech is running late" call from Ant.
//
// Defaults:
//   since_min_late = 30  (only call when tech is at least 30 min behind)
//   max_min_late   = 120 (don't surface jobs that are 2+ hours behind —
//                         those are usually mis-scheduled or canceled)
query get_running_late_jobs verb=GET {
  api_group = "intake"

  input {
    int? since_min_late?
    int? max_min_late?
  }

  stack {
    var $now_ms {
      value = now|to_ms
    }
    var $since_min {
      value = ($input.since_min_late ?? 30)
    }
    var $max_min {
      value = ($input.max_min_late ?? 120)
    }
    // upper_cutoff = scheduled_start <= this (at least $since_min min ago)
    var $upper_cutoff_ms {
      value = $now_ms - ($since_min * 60000)
    }
    // lower_cutoff = scheduled_start >= this (no older than $max_min min ago)
    var $lower_cutoff_ms {
      value = $now_ms - ($max_min * 60000)
    }

    db.query jobs {
      where = $db.jobs.scheduling_status == "scheduled" && $db.jobs.scheduled_start <= $upper_cutoff_ms && $db.jobs.scheduled_start >= $lower_cutoff_ms && ($db.jobs.job_started_at == null || $db.jobs.job_started_at == 0)
      sort = {jobs.scheduled_start: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 30}}
    } as $late_rows

    var $items {
      value = []
    }

    foreach ($late_rows.items) {
      each as $j {
        var $cust {
          value = null
        }
        var $cust_id {
          value = ($j.customer_id ?? 0)
        }
        conditional {
          if ($cust_id > 0) {
            db.get customer {
              field_name = "id"
              field_value = $cust_id
            } as $cust
          }
        }

        var $tech {
          value = null
        }
        var $tech_id {
          value = ($j.technician_id ?? 0)
        }
        conditional {
          if ($tech_id > 0) {
            db.get technicians {
              field_name = "id"
              field_value = $tech_id
            } as $tech
          }
        }

        var $sched_ms {
          value = ($j.scheduled_start ?? 0)
        }
        var $mins_behind_calc {
          value = (($now_ms - $sched_ms) / 60000)|to_int
        }

        // Also require tech_en_route_at to be null OR very stale (>20 min old)
        // — if tech is already en route, no need for a "running late" call.
        var $en_route_ms {
          value = ($j.tech_en_route_at ?? 0)
        }
        var $en_route_age_min {
          value = (($now_ms - $en_route_ms) / 60000)|to_int
        }
        var $tech_already_enroute {
          value = ($en_route_ms > 0 && $en_route_age_min < 20)
        }

        conditional {
          if ($tech_already_enroute == false && $cust != null && $tech != null) {
            var $entry {
              value = {
                job_id           : ($j.id ?? 0)
                scheduled_start_ms: $sched_ms
                minutes_behind   : $mins_behind_calc
                customer_first_name: ($cust.first_name ?? "")
                customer_phone   : ($cust.phone ?? "")
                tech_first_name  : ($tech.first_name ?? "")
                appliance_type   : ($j.appliance_type ?? "")
                service_state    : ($j.service_state ?? "")
              }
            }
            var.update $items {
              value = $items|push:$entry
            }
          }
        }
      }
    }
  }

  response = {
    success: true
    count  : ($items|count)
    items  : $items
    scanned_at_ms: $now_ms
    threshold_min_behind: $since_min
  }

  guid = "get-running-late-jobs-v1"
}
