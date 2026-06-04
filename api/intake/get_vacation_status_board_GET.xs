// Vacation status board feed — single round trip returning everything
// the vacation-status.html page needs to render. Includes loop
// heartbeat, last Vapi call review, last auto-trigger fires, recent
// errors, recent Ant call dispatches. Pulled from event_log.
query get_vacation_status_board verb=GET {
  api_group = "intake"

  input {}

  stack {
    var $now_ms { value = now|to_ms }
    var $last24h { value = $now_ms - 86400000 }
    var $last1h { value = $now_ms - 3600000 }

    // Loop heartbeat — most recent heartbeat row
    db.query event_log {
      where = $db.event_log.action == "loop_heartbeat"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $hb_rows
    var $last_hb { value = (($hb_rows.items|first) ?? null) }
    var $last_hb_ms { value = ($last_hb != null ? ($last_hb.created_at ?? 0) : 0) }
    var $hb_age_min { value = ($last_hb_ms > 0 ? (($now_ms - $last_hb_ms) / 60000)|to_int : -1) }

    // Auto-trigger counts (last 24h)
    db.query event_log {
      where = ($db.event_log.action == "appointment_reminder_handled" || $db.event_log.action == "missed_call_callback_handled" || $db.event_log.action == "parts_arrival_followup_sent" || $db.event_log.action == "tech_running_late_scan_handled" || $db.event_log.action == "voice_call_dispatched") && $db.event_log.created_at >= $last24h
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $auto_rows

    var $auto_count_24h { value = $auto_rows.items|count }

    // Recent errors (last 24h)
    db.query event_log {
      where = ($db.event_log.action|contains:"failed" || $db.event_log.action|contains:"error") && $db.event_log.created_at >= $last24h
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 20}}
    } as $error_rows

    var $errors_count { value = $error_rows.items|count }

    // Vapi call review — last digest
    db.query event_log {
      where = $db.event_log.action == "vapi_call_review_completed"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $review_rows
    var $last_review { value = (($review_rows.items|first) ?? null) }

    // Recent dispatched voice calls (so Danielle can see what Ant did)
    db.query event_log {
      where = $db.event_log.action == "voice_call_dispatched" && $db.event_log.created_at >= $last24h
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 20}}
    } as $dispatch_rows

    // Recent inbound calls
    db.query event_log {
      where = $db.event_log.action == "phone_call_summary" && $db.event_log.created_at >= $last24h
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 20}}
    } as $inbound_rows
  }

  response = {
    success           : true
    now_ms            : $now_ms
    heartbeat         : {
      last_at_ms        : $last_hb_ms
      age_min           : $hb_age_min
      healthy           : ($hb_age_min >= 0 && $hb_age_min < 15)
    }
    auto_triggers_24h : $auto_count_24h
    errors_24h        : $errors_count
    last_vapi_review  : $last_review
    recent_dispatches : $dispatch_rows.items
    recent_inbound    : $inbound_rows.items
    recent_errors     : $error_rows.items
  }

  guid = "get-vacation-status-board-v1"
}
