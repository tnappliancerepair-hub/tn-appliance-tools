// Helper for orphan_reconciler.js. Returns jobs created in the last N
// hours that have NO matching colony_signal of the given type emitted
// for them. Used to find orphans where the JOB_CREATED signal failed
// to emit due to a write race or transient outage.
query find_recent_jobs_missing_signal verb=GET {
  api_group = "intake"

  input {
    text  signal_type
    int?  hours_back?
    int?  limit?
  }

  stack {
    var $hours { value = ($input.hours_back ?? 24) }
    var $cap_raw { value = ($input.limit ?? 50) }
    var $cap { value = ($cap_raw > 200) ? 200 : $cap_raw }
    var $cutoff_ms { value = ((now|to_ms) - ($hours * 3600000)) }

    db.query jobs {
      where = $db.jobs.created_at >= $cutoff_ms
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $cap}}
    } as $job_rows

    // Pre-load all colony_signals of this type from the same window
    // (in one query, instead of per-job). Then in-memory substring
    // scan for each job_id marker.
    db.query colony_signals {
      where = $db.colony_signals.signal_type == $input.signal_type && $db.colony_signals.created_at >= $cutoff_ms
      sort = {colony_signals.id: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $signal_rows

    var $orphans { value = [] }

    foreach ($job_rows.items) {
      each as $j {
        var $job_id_marker {
          value = ("\"job_id\":" ~ ($j.id|to_text))
        }

        var $found_signal { value = false }

        foreach ($signal_rows.items) {
          each as $sig {
            var $payload_str { value = ($sig.payload ?? "") }
            var $stripped { value = ($payload_str|replace:$job_id_marker:"") }
            var $payload_len { value = ($payload_str|strlen) }
            var $stripped_len { value = ($stripped|strlen) }
            conditional {
              if ($stripped_len < $payload_len) {
                var.update $found_signal { value = true }
              }
            }
          }
        }

        conditional {
          if ($found_signal == false) {
            var $cust_id { value = ($j.customer_id ?? 0) }
            var $cust { value = null }
            conditional {
              if ($cust_id > 0) {
                db.get customer {
                  field_name = "id"
                  field_value = $cust_id
                } as $cust_row
                var.update $cust { value = $cust_row }
              }
            }

            var $orphan {
              value = {
                job_id          : $j.id
                customer_id     : $cust_id
                phone           : (($cust.phone ?? "")|trim)
                first_name      : (($cust.first_name ?? "")|trim)
                appliance_type  : (($j.appliance_type ?? "")|trim)
                brand           : (($j.brand ?? "")|trim)
                problem_summary : (($j.problem_summary ?? "")|trim)
                created_at      : $j.created_at
              }
            }

            var.update $orphans {
              value = $orphans|push:$orphan
            }
          }
        }
      }
    }
  }

  response = {
    success    : true
    signal_type: $input.signal_type
    hours_back : $hours
    jobs       : $orphans
    count      : ($orphans|count)
  }

  guid = "find-recent-jobs-missing-signal-v1"
}
