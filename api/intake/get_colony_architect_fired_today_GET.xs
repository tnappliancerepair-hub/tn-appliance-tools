query get_colony_architect_fired_today verb=GET {
  api_group = "intake"

  input {
    int since_ts_ms
  }

  stack {
    db.query event_log {
      where = $db.event_log.action == "colony_architect_fired" && $db.event_log.created_at >= $input.since_ts_ms
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows
  
    var $first {
      value = (($rows.items|first) ?? null)
    }
  
    var $fired {
      value = ($first != null)
    }
  
    var $last_at {
      value = ($first.created_at ?? null)
    }
  }

  response = {success: true, fired: $fired, last_fired_at: $last_at}
  guid = "get-colony-architect-fired-today-v1"
}