query get_capacity_check_fired_today verb=GET {
  api_group = "intake"

  input {
    int since_ts_ms
  }

  stack {
    db.query event_log {
      where = $db.event_log.action == "capacity_check_fired" && $db.event_log.created_at >= $input.since_ts_ms
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

  guid = "get-capacity-check-fired-today-v1"
}
