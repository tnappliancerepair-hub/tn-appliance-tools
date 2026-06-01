// Daily dedup for the UNPAID_SELF_PAY_DIGEST tick emit.
query get_unpaid_digest_fired_today verb=GET {
  api_group = "intake"

  input {
    int since_ts_ms
  }

  stack {
    var $since_ts {
      value = ($input.since_ts_ms / 1000)|to_timestamp
    }
  
    db.query event_log {
      where = $db.event_log.action == "unpaid_self_pay_digest_emitted" && $db.event_log.created_at >= $since_ts
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

  response = {success: true, fired: $fired, last_at: $last_at}
  guid = "get-unpaid-digest-fired-today-v1"
}