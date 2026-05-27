// Aggregates "needs human action" items into a single feed for office-todo.html.
// Sources:
//   - Jobs in not_ready/prediagnosis_pending that are >3 days old
//   - Jobs awaiting_parts with parts_eta_date past today (parts arrived,
//     customer SMS already sent by parts_arrival_check)
//   - Jobs with scheduling_status=held (warranty_auth_needed)
//   - Recent tech_job_complete_blocked_tdr_incomplete events (last 24h)
//   - Recent callback_event_logged (last 24h, completed jobs revisit)
query get_office_todo verb=GET {
  api_group = "intake"

  input {}

  stack {
    var $now_ts {
      value = now
    }

    var $now_ms {
      value = now|to_ms
    }

    var $three_days_ago_ts {
      value = $now_ts|transform_timestamp:"-3 days"
    }

    var $one_day_ago_ts {
      value = $now_ts|transform_timestamp:"-1 day"
    }

    var $now_ct {
      value = now|transform_timestamp:"-5 hours"
    }

    var $today_str {
      value = $now_ct|format_timestamp:"Y-m-d"
    }

    // Old not_ready / prediagnosis_pending jobs
    db.query jobs {
      where  = ($db.jobs.scheduling_status == "not_ready" || $db.jobs.scheduling_status == "prediagnosis_pending") && $db.jobs.created_at < $three_days_ago_ts
      sort   = {jobs.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 25}}
    } as $stale_rows

    // Held jobs (warranty_auth_needed pending)
    db.query jobs {
      where  = $db.jobs.scheduling_status == "held"
      sort   = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 25}}
    } as $held_rows

    // Awaiting parts where ETA has passed
    db.query jobs {
      where  = $db.jobs.scheduling_status == "awaiting_parts" && $db.jobs.parts_eta_date != null && $db.jobs.parts_eta_date != "" && $db.jobs.parts_eta_date <= $today_str
      sort   = {jobs.parts_eta_date: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 25}}
    } as $parts_arrived_rows

    // Recent TDR-block events (last 24h)
    db.query event_log {
      where  = $db.event_log.action == "tech_job_complete_blocked_tdr_incomplete" && $db.event_log.created_at >= $one_day_ago_ts
      sort   = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 25}}
    } as $tdr_block_rows

    // Recent callback events (last 24h)
    db.query event_log {
      where  = $db.event_log.action == "callback_event_logged" && $db.event_log.created_at >= $one_day_ago_ts
      sort   = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 25}}
    } as $callback_rows
  }

  response = {
    success                : true
    today_ct               : $today_str
    stale_intake_jobs      : $stale_rows.items
    held_jobs              : $held_rows.items
    parts_arrived_jobs     : $parts_arrived_rows.items
    tdr_blocked_events     : $tdr_block_rows.items
    callback_events        : $callback_rows.items
    counts                 : {
      stale_intake         : ($stale_rows.items|count)
      held                 : ($held_rows.items|count)
      parts_arrived        : ($parts_arrived_rows.items|count)
      tdr_blocked          : ($tdr_block_rows.items|count)
      callbacks            : ($callback_rows.items|count)
    }
  }

  guid = "get-office-todo-v1"
}
