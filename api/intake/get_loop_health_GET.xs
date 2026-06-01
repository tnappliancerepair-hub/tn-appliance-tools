// Returns loop liveness state — used by the operator-facing health
// dashboard. Green = heartbeat within last 5 min. Yellow = 5-15 min.
// Red = 15+ min stale.
query get_loop_health verb=GET {
  api_group = "intake"

  input {
  }

  stack {
    var $now_ts {
      value = now
    }
  
    var $now_ms {
      value = $now_ts|to_ms
    }
  
    db.query event_log {
      where = $db.event_log.action == "colony_loop_heartbeat"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $hb_rows
  
    var $hb {
      value = (($hb_rows.items|first) ?? null)
    }
  
    var $last_hb_ts {
      value = ($hb != null ? $hb.created_at : null)
    }
  
    var $last_hb_ms {
      value = ($hb != null ? ($hb.created_at|to_ms) : 0)
    }
  
    var $age_ms {
      value = ($last_hb_ms > 0 ? ($now_ms - $last_hb_ms) : 0)
    }
  
    var $age_seconds {
      value = ($age_ms / 1000)|round:0
    }
  
    var $status_color {
      value = ($last_hb_ms == 0 ? "red" : ($age_ms < 300000 ? "green" : ($age_ms < 900000 ? "yellow" : "red")))
    }
  
    // Also count signals processed in the last hour as activity proxy
    var $hour_ago_ts {
      value = $now_ts|transform_timestamp:"-1 hour"
    }
  
    db.query event_log {
      where = $db.event_log.action == "signal_processed" && $db.event_log.created_at >= $hour_ago_ts
      return = {type: "count"}
    } as $hour_signals
  }

  response = {
    success                : true
    status_color           : $status_color
    last_heartbeat_at      : $last_hb_ts
    last_heartbeat_age_secs: $age_seconds
    signals_last_hour      : ($hour_signals ?? 0)
    server_time_ms         : $now_ms
  }

  guid = "get-loop-health-v1"
}