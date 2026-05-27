// Daily dedup for the PARTS_ARRIVAL_CHECK tick emit. Returns true if an
// event_log row action="parts_arrival_check_emitted" has landed since
// since_ts_ms — used to prevent the 11am CT tick from re-emitting on
// successive ticks within its grace window.
query get_parts_arrival_check_fired_today verb=GET {
  api_group = "intake"

  input {
    int since_ts_ms
  }

  stack {
    var $since_ts {
      value = ($input.since_ts_ms / 1000)|to_timestamp
    }

    db.query event_log {
      where = $db.event_log.action == "parts_arrival_check_emitted" && $db.event_log.created_at >= $since_ts
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $row {
      value = (($rows.items|first) ?? null)
    }

    var $fired {
      value = ($row != null)
    }

    var $last_at {
      value = ($row != null ? $row.created_at : null)
    }
  }

  response = {
    success    : true
    fired      : $fired
    last_at    : $last_at
  }

  guid = "get-parts-arrival-check-fired-today-v1"
}
