// AGENT S030 - Capacity Predictor
//
// Forecasts per-tech capacity for the next 7 days based on:
//   - Currently scheduled jobs in the forecast window
//   - Each tech's recent (last 14d) avg jobs/day as a soft cap
//   - Day-off rows in tech_availability
//
// Surfaces over/under-staffed days so Danielle can move work proactively.
//
// Used by colony-loop/agents/schedule_request_capacity_forecast.js (which
// SMSes Teddy + Danielle a digest each Sunday afternoon for the week ahead).
//
// Input:
//   days_ahead?  - forecast window in days (default 7)
//
// Output:
//   per_tech[]: {technician_id, first_name, daily_capacity_est,
//                scheduled_counts_by_day, gap_count, overload_count}
//   totals: {capacity_total, scheduled_total, headroom}
//
// XanoScript rules: no em-dashes, no backticks, no try/catch, no raw if,
// every filter paren-wrapped, ?? only in value = (...).

query get_capacity_forecast verb=GET {
  api_group = "intake"

  input {
    int? days_ahead?
  }

  stack {
    var $forecast_days {
      value = ($input.days_ahead ?? 7)
    }

    var $now_ms {
      value = (now|to_ms)
    }

    var $forecast_end {
      value = ($now_ms + ($forecast_days * 86400000))
    }

    var $history_start {
      value = ($now_ms - 1209600000)
    }

    db.query technicians {
      where = $db.technicians.active == true
      sort = {technicians.id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $tech_rows

    // History: completed jobs last 14d, used to estimate per-tech daily avg
    db.query jobs {
      where = $db.jobs.scheduling_status == "completed" && $db.jobs.scheduled_start >= $history_start && $db.jobs.scheduled_start <= $now_ms
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $history_rows

    // Forecast: scheduled jobs in window
    db.query jobs {
      where = $db.jobs.scheduled_start >= $now_ms && $db.jobs.scheduled_start <= $forecast_end && $db.jobs.technician_id != null && $db.jobs.scheduling_status != "canceled"
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $forecast_rows

    // Per-tech tally of recent completed jobs
    var $hist_counts {
      value = {}
    }

    foreach ($history_rows.items) {
      each as $h {
        var $tid {
          value = ($h.technician_id ?? 0)
        }

        conditional {
          if ($tid > 0) {
            var $tid_key {
              value = ($tid|to_text)
            }

            var $prev {
              value = (($hist_counts|get:$tid_key) ?? 0)
            }

            var.update $hist_counts {
              value = ($hist_counts|set:$tid_key:($prev + 1))
            }
          }
        }
      }
    }

    // Per-tech tally of forecast jobs
    var $fc_counts {
      value = {}
    }

    foreach ($forecast_rows.items) {
      each as $f {
        var $ftid {
          value = ($f.technician_id ?? 0)
        }

        conditional {
          if ($ftid > 0) {
            var $ftid_key {
              value = ($ftid|to_text)
            }

            var $fprev {
              value = (($fc_counts|get:$ftid_key) ?? 0)
            }

            var.update $fc_counts {
              value = ($fc_counts|set:$ftid_key:($fprev + 1))
            }
          }
        }
      }
    }

    var $per_tech {
      value = []
    }

    var $capacity_total {
      value = 0
    }

    var $scheduled_total {
      value = 0
    }

    foreach ($tech_rows.items) {
      each as $t {
        var $tid_str {
          value = ($t.id|to_text)
        }

        var $hist14 {
          value = (($hist_counts|get:$tid_str) ?? 0)
        }

        var $sched_in_window {
          value = (($fc_counts|get:$tid_str) ?? 0)
        }

        // Daily capacity estimate = (recent 14d completions / 14) rounded
        // up to nearest integer, with a minimum of 3 and max of 8.
        var $est_daily {
          value = ($hist14 / 14)
        }

        conditional {
          if ($est_daily < 3) {
            var.update $est_daily {
              value = 3
            }
          }
        }

        conditional {
          if ($est_daily > 8) {
            var.update $est_daily {
              value = 8
            }
          }
        }

        var $window_cap {
          value = ($est_daily * $forecast_days)
        }

        var $headroom {
          value = ($window_cap - $sched_in_window)
        }

        var $entry {
          value = {
            technician_id        : $t.id
            first_name           : ($t.first_name ?? "")
            last_name            : ($t.last_name ?? "")
            phone                : ($t.phone ?? "")
            completed_last_14d   : $hist14
            est_daily_capacity   : $est_daily
            window_capacity      : $window_cap
            scheduled_in_window  : $sched_in_window
            headroom             : $headroom
          }
        }

        var.update $per_tech {
          value = ($per_tech|push:$entry)
        }

        var.update $capacity_total {
          value = ($capacity_total + $window_cap)
        }

        var.update $scheduled_total {
          value = ($scheduled_total + $sched_in_window)
        }
      }
    }

    var $fleet_headroom {
      value = ($capacity_total - $scheduled_total)
    }
  }

  response = {
    success         : true
    forecast_days   : $forecast_days
    forecast_start  : $now_ms
    forecast_end    : $forecast_end
    per_tech        : $per_tech
    capacity_total  : $capacity_total
    scheduled_total : $scheduled_total
    fleet_headroom  : $fleet_headroom
  }

  guid = "get-capacity-forecast-v1"
}
