// Dedup check for the morning Marcones-first brief — mirrors the
// daily_briefing pattern. Returns fired=true if any
// marcones_first_brief_sent row landed in event_log since since_ts_ms.
query get_marcones_first_brief_fired_today verb=GET {
  api_group = "intake"

  input {
    int since_ts_ms
  }

  stack {
    db.query event_log {
      where = $db.event_log.action == "marcones_first_brief_sent" && $db.event_log.created_at >= $input.since_ts_ms
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $first {
      value = (($rows.items|first) ?? null)
    }
    var $fired_flag {
      value = ($first != null)
    }
    var $last_at {
      value = ($first.created_at ?? null)
    }
  }

  response = {
    success      : true
    fired        : $fired_flag
    last_fired_at: $last_at
  }

  guid = "get-marcones-first-brief-fired-today-v1"
}
