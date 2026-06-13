// Office-facing call log — every Vapi call (inbound + outbound) with
// caller, duration, ended reason, summary, transcript preview. Powers
// recent-calls.html.
query list_recent_calls_for_office verb=GET {
  api_group = "intake"

  input {
    int? days?
    int? limit?
  }

  stack {
    var $days_clean { value = ($input.days ?? 7) }
    var $limit_clean { value = ($input.limit ?? 100) }
    var $cutoff_ms { value = ((now|to_ms) - ($days_clean * 86400 * 1000)) }

    db.query event_log {
      where = $db.event_log.action == "phone_call_summary" && $db.event_log.created_at >= $cutoff_ms
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $rows

    var $calls { value = ($rows.items ?? []) }
  }

  response = {
    success     : true
    calls       : $calls
    count       : ($calls|count)
    cutoff_ms   : $cutoff_ms
  }

  guid = "list-recent-calls-for-office-v1"
}
