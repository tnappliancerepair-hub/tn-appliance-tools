// AGENT OF005 - Calendar Conflict Detector
//
// Surfaces overlapping appointments per tech in the days ahead.
// Two jobs conflict when they share the same technician_id and their
// scheduled_start times fall inside the same 2-hour window.
//
// Used by colony-loop/agents/schedule_calendar_conflict_detector.js
// (which posts a Teddy SMS digest when conflicts are found).
//
// Input:
//   days_ahead?  - how many days from today_ct to scan (default 7)
//
// Output:
//   conflicts: array of {technician_id, jobs: [{id, scheduled_start_ms, customer_name, appliance, service_address}]}
//
// XanoScript rules honored: no em-dashes, no backticks, no try/catch,
// no raw if (conditional blocks only), every filter paren-wrapped,
// ?? only inside value = (...) expressions.

query list_calendar_conflicts verb=GET {
  api_group = "intake"

  input {
    int? days_ahead?
  }

  stack {
    var $window_days {
      value = ($input.days_ahead ?? 7)
    }

    var $now_ms {
      value = (now|to_ms)
    }

    var $window_ms {
      value = ($window_days * 86400000)
    }

    var $window_end {
      value = ($now_ms + $window_ms)
    }

    // Slot half-window in ms (2-hour appointments overlap if their starts
    // are within +/- 60 min of each other, i.e. 7200000 / 2).
    var $half_slot_ms {
      value = 3600000
    }

    db.query jobs {
      where = $db.jobs.scheduled_start >= $now_ms && $db.jobs.scheduled_start <= $window_end && $db.jobs.technician_id != null && $db.jobs.scheduling_status != "canceled" && $db.jobs.scheduling_status != "no_fix_possible"
      sort = {jobs.technician_id: "asc", jobs.scheduled_start: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $job_rows

    var $conflicts {
      value = []
    }

    var $prev_tech_id {
      value = 0
    }

    var $prev_job_obj {
      value = null
    }

    foreach ($job_rows.items) {
      each as $j {
        var $cur_tech_id {
          value = ($j.technician_id ?? 0)
        }

        var $cur_start {
          value = ($j.scheduled_start ?? 0)
        }

        conditional {
          if ($cur_tech_id == $prev_tech_id && $prev_job_obj != null) {
            var $prev_start {
              value = ($prev_job_obj.scheduled_start ?? 0)
            }

            var $gap_ms {
              value = ($cur_start - $prev_start)
            }

            conditional {
              if ($gap_ms >= 0 && $gap_ms <= $half_slot_ms) {
                var $conflict_entry {
                  value = {
                    technician_id     : $cur_tech_id
                    gap_minutes       : ($gap_ms / 60000)
                    earlier_job_id    : $prev_job_obj.id
                    earlier_start_ms  : $prev_start
                    later_job_id      : $j.id
                    later_start_ms    : $cur_start
                    later_customer_id : ($j.customer_id ?? null)
                    later_appliance   : ($j.appliance_type ?? "")
                    later_brand       : ($j.brand ?? "")
                    later_address     : ($j.service_address ?? "")
                  }
                }

                var.update $conflicts {
                  value = ($conflicts|push:$conflict_entry)
                }
              }
            }
          }
        }

        var.update $prev_tech_id {
          value = $cur_tech_id
        }

        var.update $prev_job_obj {
          value = $j
        }
      }
    }
  }

  response = {
    success           : true
    window_days       : $window_days
    window_start_ms   : $now_ms
    window_end_ms     : $window_end
    jobs_scanned      : ($job_rows.items|count)
    conflict_count    : ($conflicts|count)
    conflicts         : $conflicts
  }

  guid = "list-calendar-conflicts-v1"
}
