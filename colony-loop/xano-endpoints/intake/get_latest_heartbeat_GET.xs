// Returns the single most-recent colony_loop_heartbeat row. Used by the
// standalone healthcheck script — Metadata API content/search doesn't
// sort by recency reliably, so we route via this XS endpoint instead.
query get_latest_heartbeat verb=GET {
  api_group = "intake"

  input {
    int? _unused?
  }

  stack {
    db.query event_log {
      where  = $db.event_log.action == "colony_loop_heartbeat"
      sort   = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $row { value = (($rows.items|count) > 0) ? ($rows.items|get:0) : null }
  }

  response = {
    success: true
    found  : ($row != null)
    id     : ($row != null) ? $row.id : 0
    created_at: ($row != null) ? $row.created_at : 0
    age_ms : ($row != null) ? ((now|to_ms) - $row.created_at) : 0
  }

  guid = "get-latest-heartbeat-v1"
}
