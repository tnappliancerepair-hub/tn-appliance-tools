// Dedup for the weekly performance summary signal. Returns whether a
// weekly_performance_summary_emitted row exists in event_log since the
// passed timestamp (caller passes start-of-current-week-CT ms).
query get_weekly_performance_fired verb=GET {
  api_group = "intake"

  input {
    int since_ts_ms
  }

  stack {
    db.query event_log {
      where = $db.event_log.action == "weekly_performance_summary_emitted" && $db.event_log.created_at >= $input.since_ts_ms
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $first {
      value = (($rows.items|first) ?? null)
    }
  }

  response = {
    fired      : ($first != null)
    last_fired : ($first != null) ? $first.created_at : null
  }

  guid = "get-weekly-performance-fired-v1"
}
