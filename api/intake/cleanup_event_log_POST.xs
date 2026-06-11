//  Garbage-collects event_log rows. event_log is the highest-churn table
//  (~48k rows/day) and the bulk of the workspace record count (storage on the
//  10GB Essential cap) + the reason metadata.job_id JSON scans are slow.
//
//  TWO modes:
//   - noise_only:true  → delete ONLY high-volume, non-dedup "plumbing" rows
//       (signal_processed / signal_no_agent_yet / colony_signal_emitted /
//        signal_dispatched / loop_tick / loop_heartbeat / tick_skipped_overlap).
//       These are NOT read by any agent's dedup, so deleting them can never
//       cause a re-fire (re-text / re-submit). Safe to run aggressively/nightly.
//       Default cutoff 7 days, floor 2.
//   - default (noise_only false) → blanket age delete of EVERYTHING older than
//       the cutoff. Keep this window LONGER than the longest dedup lookback
//       (~90 days) so it never deletes a row an agent still relies on.
//       Default cutoff 30 days, floor 7.
//
//  Safety (both modes): dry_run returns the would-delete count without writing;
//  max_delete caps a single call at <=10k rows (run repeatedly to drain).
query cleanup_event_log verb=POST {
  api_group = "intake"

  input {
    int? older_than_days?
    bool? dry_run?
    int? max_delete?
    bool? noise_only?
  }

  stack {
    var $is_noise { value = ($input.noise_only ?? false) }

    // Mode-aware defaults + floors.
    var $default_days { value = ($is_noise) ? 7 : 30 }
    var $floor_days   { value = ($is_noise) ? 2 : 7 }
    var $days_req     { value = ($input.older_than_days ?? $default_days) }
    var $days_eff     { value = ($days_req < $floor_days) ? $floor_days : $days_req }

    var $cap_req  { value = ($input.max_delete ?? 10000) }
    var $cap_eff  { value = ($cap_req > 10000) ? 10000 : $cap_req }
    var $cutoff_ms { value = ((now|to_ms) - ($days_eff * 86400000)) }
    var $is_dry   { value = ($input.dry_run ?? false) }

    var $candidates { value = [] }

    // Noise mode: restrict to the non-dedup plumbing actions.
    conditional {
      if ($is_noise) {
        db.query event_log {
          where = ($db.event_log.action == "signal_processed" || $db.event_log.action == "signal_no_agent_yet" || $db.event_log.action == "colony_signal_emitted" || $db.event_log.action == "signal_dispatched" || $db.event_log.action == "loop_tick" || $db.event_log.action == "loop_heartbeat" || $db.event_log.action == "tick_skipped_overlap") && $db.event_log.created_at < $cutoff_ms
          sort = {event_log.created_at: "asc"}
          return = {type: "list", paging: {page: 1, per_page: $cap_eff}}
        } as $noise_rows
        var.update $candidates { value = $noise_rows.items }
      }
    }

    // Blanket mode: everything older than the (longer) cutoff.
    conditional {
      if (!$is_noise) {
        db.query event_log {
          where = $db.event_log.created_at < $cutoff_ms
          sort = {event_log.created_at: "asc"}
          return = {type: "list", paging: {page: 1, per_page: $cap_eff}}
        } as $all_rows
        var.update $candidates { value = $all_rows.items }
      }
    }

    var $candidate_count { value = 0 }
    var $deleted_count   { value = 0 }

    foreach ($candidates) {
      each as $row {
        var.update $candidate_count { value = ($candidate_count + 1) }
        conditional {
          if (!$is_dry) {
            db.del event_log {
              field_name = "id"
              field_value = $row.id
            }
            var.update $deleted_count { value = ($deleted_count + 1) }
          }
        }
      }
    }

    db.add event_log {
      data = {
        action  : "event_log_cleanup"
        metadata: {
          mode           : ($is_noise) ? "noise_only" : "all"
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
    mode           : ($is_noise) ? "noise_only" : "all"
    older_than_days: $days_eff
    cutoff_ms      : $cutoff_ms
    dry_run        : $is_dry
    candidates_seen: $candidate_count
    deleted_count  : $deleted_count
    max_delete_cap : $cap_eff
  }

  guid = "cleanup-event-log-v1"
}
