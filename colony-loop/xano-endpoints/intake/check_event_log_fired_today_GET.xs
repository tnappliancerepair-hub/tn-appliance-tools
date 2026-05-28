// Idempotency check for daily-fired agents (warranty_learning_aggregator,
// office_morning_briefing, etc.). Given an action name + day_key string
// (YYYY-MM-DD), returns whether any event_log row exists today with
// matching action + day_key inside its metadata.
//
// We avoid json_decode in the hot path — substring match on the JSON
// string is faster + parser-safer per the XS footgun catalog.
query check_event_log_fired_today verb=GET {
  api_group = "intake"

  input {
    text action filters=trim
    text day_key filters=trim
  }

  stack {
    precondition ($input.action != "" && $input.day_key != "") {
      error_type = "inputerror"
      error      = "action and day_key are required"
    }

    // 26-hour window for "today" — covers CT/UTC boundary skew.
    var $cutoff_ms {
      value = (now|to_ms) - (26 * 3600000)
    }

    db.query event_log {
      where  = $db.event_log.action == $input.action && $db.event_log.created_at >= $cutoff_ms
      sort   = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $rows

    var $fired { value = false }
    var $needle { value = "\"day\":\"" ~ $input.day_key ~ "\"" }
    var $needle_alt { value = "\"day_key\":\"" ~ $input.day_key ~ "\"" }

    foreach ($rows.items) {
      each as $r {
        var $meta_str { value = ($r.metadata ?? "")|to_text }
        conditional {
          if (($meta_str|contains:$needle) || ($meta_str|contains:$needle_alt)) {
            var.update $fired { value = true }
          }
        }
      }
    }
  }

  response = {
    success : true
    action  : $input.action
    day_key : $input.day_key
    fired   : $fired
  }

  guid = "check-event-log-fired-today-v1"
}
