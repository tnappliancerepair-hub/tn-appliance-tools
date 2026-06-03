// Dedup probe — has DAILY_VAPI_CALL_REVIEW already fired today?
// Same pattern as get_daily_claude_spend_fired_today.
query get_daily_vapi_call_review_fired_today verb=GET {
  api_group = "intake"

  input {
    int? since_ts_ms?
  }

  stack {
    var $cutoff_ms { value = $input.since_ts_ms ?? ((now|to_ms) - 86400000) }

    db.query event_log {
      where = $db.event_log.action == "daily_vapi_call_review_emitted" && $db.event_log.created_at >= $cutoff_ms
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $first { value = (($rows.items|first) ?? null) }
    var $last_at { value = 0 }
    conditional {
      if ($first != null) {
        var.update $last_at { value = $first.created_at }
      }
    }
  }

  response = {
    success : true
    fired   : ($first != null)
    last_at : $last_at
  }

  guid = "get-daily-vapi-call-review-fired-today-v1"
}
