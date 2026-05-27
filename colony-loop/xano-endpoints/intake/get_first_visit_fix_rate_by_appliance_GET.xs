// Per-appliance first-visit fix rate over last N days. Shows which
// appliance categories we're strongest/weakest on.
query get_first_visit_fix_rate_by_appliance verb=GET {
  api_group = "intake"

  input {
    int? days?
  }

  stack {
    var $days {
      value = ($input.days ?? 30)
    }

    var $cutoff_ms {
      value = (now|to_ms) - ($days * 24 * 60 * 60 * 1000)
    }

    var $cutoff_ts {
      value = ($cutoff_ms / 1000)|to_timestamp
    }

    db.query jobs {
      where  = ($db.jobs.scheduling_status == "completed" || $db.jobs.scheduling_status == "awaiting_parts" || $db.jobs.scheduling_status == "held") && $db.jobs.job_completed_at != null && $db.jobs.job_completed_at >= $cutoff_ts
      sort   = {jobs.job_completed_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $rows

    var $buckets {
      value = {}
    }

    foreach ($rows.items) {
      each as $j {
        var $appl {
          value = (($j.appliance_type ?? "")|trim|lower)
        }

        var $key {
          value = ($appl != "" ? $appl : "unknown")
        }

        var $is_completed {
          value = ($j.scheduling_status == "completed")
        }

        var $existing {
          value = (($buckets|get:$key) ?? {total:0, completed:0})
        }

        var $new_total {
          value = ($existing.total ?? 0) + 1
        }

        var $new_completed {
          value = ($existing.completed ?? 0) + ($is_completed ? 1 : 0)
        }

        var $new_bucket {
          value = { total: $new_total, completed: $new_completed }
        }

        var.update $buckets {
          value = $buckets|set:$key:$new_bucket
        }
      }
    }

    var $keys {
      value = $buckets|keys
    }

    var $out {
      value = []
    }

    foreach ($keys) {
      each as $k {
        var $b {
          value = ($buckets|get:$k)
        }

        var $rate_raw {
          value = ($b.total > 0 ? ($b.completed / $b.total) : 0)
        }

        var $entry {
          value = {
            appliance        : $k
            total_terminal   : $b.total
            first_visit_fixed: $b.completed
            fix_rate         : ($rate_raw|round:3)
          }
        }

        var.update $out {
          value = $out|push:$entry
        }
      }
    }
  }

  response = {
    success : true
    days    : $days
    buckets : $out
  }

  guid = "get-first-visit-fix-rate-by-appliance-v1"
}
