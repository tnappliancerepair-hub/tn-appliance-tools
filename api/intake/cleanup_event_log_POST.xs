//  Deletes event_log rows older than the given threshold. event_log is the
//  highest-churn table (~48k rows/day from record_event_log alone) and was
//  never garbage-collected — it is the bulk of the workspace's record count
//  (storage pressure on the 10GB Essential cap) AND why metadata.job_id JSON
//  scans got slow. Run nightly to bound it.
//
//  Defaults: 30-day cutoff. Mirrors cleanup_colony_signals safety:
//    - hard floor of 7 days (a typo can't wipe recent audit history)
//    - dry_run returns the would-delete count without writing
//    - max_delete cap (<=10k/call) so one run can't drop a huge slice at once.
//      To drain a large backlog, call repeatedly (or schedule nightly and let
//      it catch up over a few runs).
query cleanup_event_log verb=POST {
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

    // Oldest-first so repeated runs drain the backlog from the bottom.
    db.query event_log {
      where = $db.event_log.created_at < $cutoff_ms
      sort = {event_log.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: $cap_eff}}
    } as $candidate_rows

    var $candidates {
      value = $candidate_rows.items
    }

    var $candidate_count {
      value = 0
    }

    var $deleted_count {
      value = 0
    }

    foreach ($candidates) {
      each as $row {
        var.update $candidate_count {
          value = ($candidate_count + 1)
        }

        conditional {
          if (!$is_dry) {
            db.del event_log {
              field_name = "id"
              field_value = $row.id
            }

            var.update $deleted_count {
              value = ($deleted_count + 1)
            }
          }
        }
      }
    }

    // Audit the cleanup itself (one row — negligible vs what it removes).
    db.add event_log {
      data = {
        action  : "event_log_cleanup"
        metadata: {
          older_than_days: $days_eff
          cutoff_ms      : $cutoff_ms
          dry_run        : $is_dry
          candidates_seen: $candidate_count
          deleted_count  : $deleted_count
          max_delete_cap : $cap_eff
        }
      }
    } as $log
  }

  response = {
    success        : true
    older_than_days: $days_eff
    cutoff_ms      : $cutoff_ms
    dry_run        : $is_dry
    candidates_seen: $candidate_count
    deleted_count  : $deleted_count
    max_delete_cap : $cap_eff
  }

  guid = "cleanup-event-log-v1"
}
