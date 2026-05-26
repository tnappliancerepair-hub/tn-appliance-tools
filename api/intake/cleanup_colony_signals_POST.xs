// Deletes processed colony_signals rows older than the given threshold.
// Run nightly (or on-demand) to bound the table's growth — at ~3 rows/min
// the table would otherwise grow ~1.5M rows/year and slow queries.
//
// Defaults: 30-day cutoff, processed_at IS NOT NULL only (never deletes
// pending signals even if they're old — those are unhandled bugs to fix).
//
// Safety:
//   - hard floor of 7 days (callers can't blow away yesterday's data by typo)
//   - dry_run input returns the would-delete count without writing
//   - max_delete cap prevents a single call from removing more than 10k rows
//     so a misconfigured cron doesn't drop tens of MB at once
query cleanup_colony_signals verb=POST {
  api_group = "intake"

  input {
    int? older_than_days?
    bool? dry_run?
    int? max_delete?
  }

  stack {
    var $days_req {
      value = ($input.older_than_days ?? 30)
    }

    // Hard floor: never delete anything < 7 days old.
    var $days_eff {
      value = ($days_req < 7) ? 7 : $days_req
    }

    var $cap_req {
      value = ($input.max_delete ?? 10000)
    }

    var $cap_eff {
      value = ($cap_req > 10000) ? 10000 : $cap_req
    }

    var $cutoff_ms {
      value = ((now|to_ms) - ($days_eff * 86400000))
    }

    var $is_dry {
      value = ($input.dry_run ?? false)
    }

    // Find candidates: processed (processed_at IS NOT NULL) AND old.
    db.query colony_signals {
      where  = $db.colony_signals.processed_at != null && $db.colony_signals.processed_at < $cutoff_ms
      sort   = {colony_signals.processed_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: $cap_eff}}
    } as $candidate_rows

    var $candidates {
      value = $candidate_rows.items
    }

    var $candidate_count { value = 0 }
    var $deleted_count   { value = 0 }

    foreach ($candidates) {
      each as $row {
        var.update $candidate_count { value = ($candidate_count + 1) }

        conditional {
          if (!$is_dry) {
            db.del colony_signals {
              field_name  = "id"
              field_value = $row.id
            }
            var.update $deleted_count { value = ($deleted_count + 1) }
          }
        }
      }
    }

    db.add event_log {
      data = {
        action  : "colony_signals_cleanup"
        metadata: {
          older_than_days   : $days_eff
          cutoff_ms         : $cutoff_ms
          dry_run           : $is_dry
          candidates_seen   : $candidate_count
          deleted_count     : $deleted_count
          max_delete_cap    : $cap_eff
        }
      }
    } as $log
  }

  response = {
    success         : true
    older_than_days : $days_eff
    cutoff_ms       : $cutoff_ms
    dry_run         : $is_dry
    candidates_seen : $candidate_count
    deleted_count   : $deleted_count
    max_delete_cap  : $cap_eff
  }

  guid = "cleanup-colony-signals-v1"
}
