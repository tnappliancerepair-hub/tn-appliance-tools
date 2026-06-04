// Returns all calls in the window + the set of vapi_call_ids that
// have already been marked reviewed. Frontend cross-references to
// flag calls that need attention.
query list_calls_for_review verb=GET {
  api_group = "intake"

  input {
    int? days?
  }

  stack {
    var $days_clean { value = ($input.days ?? 7) }
    var $cutoff_ms { value = ((now|to_ms) - ($days_clean * 86400 * 1000)) }

    db.query event_log {
      where = $db.event_log.action == "phone_call_summary" && $db.event_log.created_at >= $cutoff_ms
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $call_rows

    db.query event_log {
      where = $db.event_log.action == "call_reviewed" && $db.event_log.created_at >= $cutoff_ms
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $review_rows

    var $calls { value = ($call_rows.items ?? []) }
    var $reviews { value = ($review_rows.items ?? []) }
  }

  response = {
    success: true
    calls  : $calls
    reviews: $reviews
    cutoff_ms: $cutoff_ms
  }

  guid = "list-calls-for-review-v1"
}
