// Real-time "something just happened on a job that needs office
// attention" inbox. Watches event_log for action types that imply
// follow-up: TDR finalized (warranty ready), job completed with parts
// needed, new intake from call, low-rating customer feedback, change
// requests received. Cross-references inbox_item_handled rows to
// auto-dismiss items the office already cleared.
query get_office_inbox verb=GET {
  api_group = "intake"

  input {
    int? hours_back?
  }

  stack {
    var $hours_clean { value = ($input.hours_back ?? 48) }
    var $cutoff_ms { value = ((now|to_ms) - ($hours_clean * 3600 * 1000)) }

    // Pull all candidate event types in the window in one query
    db.query event_log {
      where = ($db.event_log.action == "tdr_finalized_from_voice" || $db.event_log.action == "tdr_submitted" || $db.event_log.action == "job_created_from_vapi_call" || $db.event_log.action == "customer_feedback_received" || $db.event_log.action == "change_request_submitted" || $db.event_log.action == "parts_order_logged" || $db.event_log.action == "ant_field_assist_call_summary_sent") && $db.event_log.created_at >= $cutoff_ms
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $event_rows

    db.query event_log {
      where = $db.event_log.action == "inbox_item_handled" && $db.event_log.created_at >= $cutoff_ms
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $handled_rows

    var $items { value = ($event_rows.items ?? []) }
    var $handled { value = ($handled_rows.items ?? []) }
  }

  response = {
    success      : true
    items        : $items
    handled      : $handled
    cutoff_ms    : $cutoff_ms
  }

  guid = "get-office-inbox-v1"
}
