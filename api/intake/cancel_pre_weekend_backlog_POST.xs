// Archives pre-weekend AHS/SP backlog: any job with scheduling_status="not_ready"
// AND created_at < cutoff_ms is flipped to scheduling_status="canceled" with
// notes_internal appended. Reversible (no row deletion).
//
// Default cutoff: Sat May 30 00:00 CT (1780117200000 ms).
// Cap: 500 jobs per call. dry_run option returns the candidate count only.
query cancel_pre_weekend_backlog verb=POST {
  api_group = "intake"

  input {
    int? cutoff_ms?
    bool? dry_run?
    int? max_cancel?
  }

  stack {
    var $cutoff_eff {
      value = ($input.cutoff_ms ?? 1780117200000)
    }

    var $cap_req {
      value = ($input.max_cancel ?? 500)
    }

    var $cap_eff {
      value = ($cap_req > 500) ? 500 : $cap_req
    }

    var $is_dry {
      value = ($input.dry_run ?? false)
    }

    db.query jobs {
      where = $db.jobs.scheduling_status == "not_ready" && $db.jobs.created_at < $cutoff_eff
      sort = {jobs.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: $cap_eff}}
    } as $candidate_rows

    var $candidates {
      value = $candidate_rows.items
    }

    var $candidate_count {
      value = 0
    }

    var $canceled_count {
      value = 0
    }

    foreach ($candidates) {
      each as $row {
        var.update $candidate_count {
          value = ($candidate_count + 1)
        }

        conditional {
          if (!$is_dry) {
            var $prior_notes {
              value = ($row.notes_internal ?? "")
            }

            var $marker {
              value = "\n---\nARCHIVED 2026-05-31: pre-weekend backlog cleanup. Original status: not_ready."
            }

            db.edit jobs {
              field_name = "id"
              field_value = $row.id
              data = {
                scheduling_status: "canceled"
                current_status   : "canceled"
                notes_internal   : ($prior_notes ~ $marker)
              }
            }

            var.update $canceled_count {
              value = ($canceled_count + 1)
            }
          }
        }
      }
    }

    db.add event_log {
      data = {
        action  : "pre_weekend_backlog_archived"
        metadata: {
        cutoff_ms      : $cutoff_eff
        dry_run        : $is_dry
        candidates_seen: $candidate_count
        canceled_count : $canceled_count
        max_cancel_cap : $cap_eff
      }
      }
    } as $log
  }

  response = {
    success        : true
    cutoff_ms      : $cutoff_eff
    dry_run        : $is_dry
    candidates_seen: $candidate_count
    canceled_count : $canceled_count
    max_cancel_cap : $cap_eff
  }

  guid = "cancel-pre-weekend-backlog-v1"
}
