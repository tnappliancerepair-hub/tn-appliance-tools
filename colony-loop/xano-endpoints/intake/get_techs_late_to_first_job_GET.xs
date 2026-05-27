// Returns techs scheduled for an early-morning first job today who have
// not yet tapped Start Job. Drives the late-morning nudge sweep.
//
// "Late" = first scheduled job for the tech today starts at/before
// cutoff_hour_ct (default 10) AND now is past start time AND
// job_started_at is still null AND scheduling_status != canceled.
query get_techs_late_to_first_job verb=GET {
  api_group = "intake"

  input {
    int? cutoff_hour_ct?
  }

  stack {
    var $cutoff_in {
      value = ($input.cutoff_hour_ct ?? 10)
    }

    var $now_ts {
      value = now
    }

    var $now_ct {
      value = $now_ts|transform_timestamp:"-5 hours"
    }

    var $today_str {
      value = $now_ct|format_timestamp:"Y-m-d"
    }

    var $day_start_utc {
      value = (($today_str ~ " 00:00:00")|to_timestamp)|transform_timestamp:"+5 hours"
    }

    var $day_end_utc {
      value = $day_start_utc|transform_timestamp:"+1 day"
    }

    // Cutoff = today CT day-start + cutoff_hour. Built by adding ms to
    // day_start_utc rather than string concat (avoids padding issues).
    var $day_start_ms {
      value = $day_start_utc|to_ms
    }

    var $cutoff_offset_ms {
      value = $cutoff_in * 3600 * 1000
    }

    var $cutoff_ms_total {
      value = $day_start_ms + $cutoff_offset_ms
    }

    var $cutoff_utc {
      value = ($cutoff_ms_total / 1000)|to_timestamp
    }

    // Pull all jobs scheduled to start today, sorted by tech_id+start
    db.query jobs {
      where  = $db.jobs.scheduled_start >= $day_start_utc && $db.jobs.scheduled_start < $day_end_utc && $db.jobs.scheduling_status != "canceled" && $db.jobs.technician_id != null && $db.jobs.technician_id > 0
      sort   = {jobs.scheduled_start: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $job_rows

    // Bucket by tech_id, find first job per tech
    var $first_job_per_tech {
      value = {}
    }

    foreach ($job_rows.items) {
      each as $job {
        var $tech_id_val {
          value = ($job.technician_id ?? 0)
        }

        var $tech_key {
          value = $tech_id_val|to_text
        }

        var $existing {
          value = (($first_job_per_tech|get:$tech_key) ?? null)
        }

        conditional {
          if ($existing == null) {
            var.update $first_job_per_tech {
              value = $first_job_per_tech|set:$tech_key:$job
            }
          }
        }
      }
    }

    // Filter to first-jobs starting at/before cutoff AND past now AND not started
    var $late_keys {
      value = $first_job_per_tech|keys
    }

    var $late_techs {
      value = []
    }

    foreach ($late_keys) {
      each as $k {
        var $j {
          value = ($first_job_per_tech|get:$k)
        }

        var $started_v {
          value = ($j.job_started_at ?? null)
        }

        var $start_ts {
          value = $j.scheduled_start
        }

        conditional {
          if ($start_ts <= $cutoff_utc && $start_ts <= $now_ts && $started_v == null) {
            // Pull tech for SMS
            db.get technicians {
              field_name = "id"
              field_value = $j.technician_id
            } as $tech_full

            var $tech_first { value = ($tech_full.first_name ?? "") }
            var $tech_phone { value = ($tech_full.phone ?? "") }

            // Pull customer for context
            var $cust_first { value = "" }

            var $cust_id_val {
              value = ($j.customer_id ?? 0)
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

                var.update $cust_first {
                  value = $first_raw
                }
              }
            }

            var $entry {
              value = {
                tech_id          : $j.technician_id
                tech_first       : $tech_first
                tech_phone       : $tech_phone
                job_id           : $j.id
                scheduled_start  : $j.scheduled_start
                customer_first   : $cust_first
                appliance_type   : ($j.appliance_type ?? "")
              }
            }

            var.update $late_techs {
              value = $late_techs|push:$entry
            }
          }
        }
      }
    }
  }

  response = {
    success      : true
    today_ct     : $today_str
    cutoff_hour  : $cutoff_in
    late_count   : ($late_techs|count)
    late_techs   : $late_techs
  }

  guid = "get-techs-late-to-first-job-v1"
}
