// Dedup: has the DAILY_JOB_PREP agent already fired today? Used by
// tick.js to ensure the 6:30am CT trigger only emits one signal per day
// regardless of how often the loop ticks during the grace window.
query get_daily_job_prep_fired_today verb=GET {
  api_group = "intake"

  input {
    int since_ts_ms
  }

  stack {
    db.query event_log {
      where = $db.event_log.action == "daily_job_prep_fired" && $db.event_log.created_at >= $input.since_ts_ms
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows
  
    var $first {
      value = (($rows.items|first) ?? null)
    }
  
    var $fired_flag {
      value = ($first != null)
    }
  
    var $last_at {
      value = ($first.created_at ?? null)
    }
  }

  response = {
    success      : true
    fired        : $fired_flag
    last_fired_at: $last_at
  }

  guid = "get-daily-job-prep-fired-today-v1"
}