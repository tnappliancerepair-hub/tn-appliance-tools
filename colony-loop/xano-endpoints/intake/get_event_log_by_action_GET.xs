// Generic dedup lookup. Returns {exists, last_at} for the most recent
// event_log row matching the given action string. Used by agents that
// rely on compound-action dedup keys (e.g. "waiver_due_sent_<job>_<ts>",
// "parts_arrival_followup_sent_<job>_<eta>") without needing a
// per-action endpoint.
query get_event_log_by_action verb=GET {
  api_group = "intake"

  input {
    text action
  }

  stack {
    var $key {
      value = ($input.action ?? "")|trim
    }

    db.query event_log {
      where = $db.event_log.action == $key
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $row {
      value = (($rows.items|first) ?? null)
    }

    var $exists {
      value = ($row != null)
    }

    var $last_at {
      value = ($row != null ? $row.created_at : null)
    }
  }

  response = {
    success  : true
    action   : $key
    exists   : $exists
    last_at  : $last_at
  }

  guid = "get-event-log-by-action-v1"
}
