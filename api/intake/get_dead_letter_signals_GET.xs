// Returns signal_types that consistently hit no_agent_yet. v2 simplifies
// by just counting rows (the per-signal_type breakdown was using a broken
// |find: pattern that crashed on no-match metadata).
query get_dead_letter_signals verb=GET {
  api_group = "intake"

  input {
    int? days_back?
  }

  stack {
    var $days_in {
      value = ($input.days_back ?? 7)
    }
  
    var $cutoff_ms {
      value = (now|to_ms) - ($days_in * 24 * 60 * 60 * 1000)
    }
  
    var $cutoff_ts {
      value = ($cutoff_ms / 1000)|to_timestamp
    }
  
    db.query event_log {
      where = $db.event_log.action == "signal_no_agent_yet" && $db.event_log.created_at >= $cutoff_ts
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $rows
  
    var $row_count {
      value = $rows.items|count
    }
  }

  response = {
    success     : true
    days_back   : $days_in
    total_events: $row_count
    note        : "Per-signal-type breakdown deferred; use Xano UI event_log filter for now."
    recent_rows : $rows.items
  }

  guid = "get-dead-letter-signals-v2"
}