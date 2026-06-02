query get_daily_hcp_coverage_fired_today verb=GET {
  api_group = "intake"
  input { int? since_ts_ms? }
  stack {
    var $cutoff_ms { value = $input.since_ts_ms ?? ((now|to_ms) - 86400000) }
    db.query event_log {
      where = $db.event_log.action == "daily_hcp_coverage_emitted" && $db.event_log.created_at >= $cutoff_ms
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows
    var $first { value = (($rows.items|first) ?? null) }
  }
  response = { success: true, fired: ($first != null), last_at: ($first != null) ? $first.created_at : 0 }
  guid = "get-daily-hcp-coverage-fired-today-v1"
}
