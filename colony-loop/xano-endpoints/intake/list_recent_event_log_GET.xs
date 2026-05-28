// Generic recent-event_log lookup used by colony-loop agents that need
// to scan a window of past events (e.g. warranty_learning_aggregator
// reads warranty_correction rows over the last 14 days).
//
// Inputs:
//   action     — event_log action name to filter by
//   days_back  — window size in days (default 14)
//   limit      — max rows returned (default 500, cap 2000)
//
// Returns: items[{id, action, metadata, created_at}] sorted desc by created_at.
query list_recent_event_log verb=GET {
  api_group = "intake"

  input {
    text action filters=trim
    int? days_back?
    int? limit?
  }

  stack {
    precondition ($input.action != "") {
      error_type = "inputerror"
      error      = "action is required"
    }

    var $days {
      value = (($input.days_back ?? 14))
    }
    var $cutoff_ms {
      value = (now|to_ms) - ($days * 86400000)
    }
    var $cap {
      value = (($input.limit ?? 500))
    }
    conditional {
      if ($cap > 2000) { var.update $cap { value = 2000 } }
    }
    conditional {
      if ($cap < 1) { var.update $cap { value = 1 } }
    }

    db.query event_log {
      where  = $db.event_log.action == $input.action && $db.event_log.created_at >= $cutoff_ms
      sort   = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $cap}}
    } as $rows
  }

  response = {
    success    : true
    action     : $input.action
    days_back  : $days
    count      : ($rows.items|count)
    items      : $rows.items
  }

  guid = "list-recent-event-log-v1"
}
