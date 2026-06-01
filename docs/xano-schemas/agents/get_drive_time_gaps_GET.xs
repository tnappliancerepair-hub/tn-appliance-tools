// AGENT S009 - Gap Calculator
//
// Computes real, drive-time-aware gaps in each tech's day. For each tech
// with at least one scheduled job today (or the requested day), walks
// through their ordered job list and emits the time gap between each
// pair of consecutive jobs (less an assumed job duration + drive buffer).
//
// Pure server-side compute - actual Google Distance Matrix lookup is
// done by the calling JS agent (S009 in colony-loop) so the agent can
// invoke the GOOGLE_MAPS_API_KEY-backed Netlify function. This endpoint
// supplies the geometry the agent needs to make those lookups.
//
// Used by colony-loop/agents/schedule_request_gap_calculator.js (and
// reused by S021 Gap Filler, S012 Real-Time Gap Watcher).
//
// Input:
//   date_ct?  - YYYY-MM-DD in CT (default today)
//
// Output:
//   per_tech[]: {technician_id, jobs: [{id, scheduled_start_ms, service_address, service_zip, estimated_duration_min}]}
//
// Caller computes gaps from consecutive jobs in each tech's list.
//
// XanoScript rules: no em-dashes, no backticks, no try/catch, no raw if,
// every filter paren-wrapped, ?? only in value = (...).

query get_drive_time_gaps verb=GET {
  api_group = "intake"

  input {
    text? date_ct? filters=trim
  }

  stack {
    var $today_ct {
      value = (now|date_format:"yyyy-MM-dd":"America/Chicago")
    }

    var $req_date {
      value = ($input.date_ct ?? "")
    }

    var $target_date {
      value = $today_ct
    }

    conditional {
      if ($req_date != "") {
        var.update $target_date {
          value = $req_date
        }
      }
    }

    // Convert target_date YYYY-MM-DD CT to start-of-day and end-of-day ms.
    var $start_str {
      value = ($target_date ~ " 00:00:00")
    }

    var $end_str {
      value = ($target_date ~ " 23:59:59")
    }

    var $start_ms {
      value = ($start_str|datetime_to_ms:"yyyy-MM-dd HH:mm:ss":"America/Chicago")
    }

    var $end_ms {
      value = ($end_str|datetime_to_ms:"yyyy-MM-dd HH:mm:ss":"America/Chicago")
    }

    db.query technicians {
      where = $db.technicians.active == true
      sort = {technicians.id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $tech_rows

    db.query jobs {
      where = $db.jobs.scheduled_start >= $start_ms && $db.jobs.scheduled_start <= $end_ms && $db.jobs.technician_id != null && $db.jobs.scheduling_status != "canceled"
      sort = {jobs.technician_id: "asc", jobs.scheduled_start: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $job_rows

    var $per_tech {
      value = []
    }

    foreach ($tech_rows.items) {
      each as $t {
        var $tech_jobs {
          value = []
        }

        foreach ($job_rows.items) {
          each as $j {
            conditional {
              if (($j.technician_id ?? 0) == $t.id) {
                // Soft default for est duration: 90 min per job. Caller
                // can refine using S031 Job Duration Learner output.
                var $entry {
                  value = {
                    id                       : $j.id
                    scheduled_start_ms       : ($j.scheduled_start ?? 0)
                    service_address          : ($j.service_address ?? "")
                    service_city             : ($j.service_city ?? "")
                    service_zip              : ($j.service_zip ?? "")
                    customer_id              : ($j.customer_id ?? null)
                    appliance_type           : ($j.appliance_type ?? "")
                    brand                    : ($j.brand ?? "")
                    estimated_duration_min   : 90
                    scheduling_status        : ($j.scheduling_status ?? "")
                  }
                }

                var.update $tech_jobs {
                  value = ($tech_jobs|push:$entry)
                }
              }
            }
          }
        }

        var $tech_block {
          value = {
            technician_id : $t.id
            first_name    : ($t.first_name ?? "")
            phone         : ($t.phone ?? "")
            job_count     : ($tech_jobs|count)
            jobs          : $tech_jobs
          }
        }

        var.update $per_tech {
          value = ($per_tech|push:$tech_block)
        }
      }
    }
  }

  response = {
    success         : true
    date_ct         : $target_date
    day_start_ms    : $start_ms
    day_end_ms      : $end_ms
    per_tech        : $per_tech
  }

  guid = "get-drive-time-gaps-v1"
}
