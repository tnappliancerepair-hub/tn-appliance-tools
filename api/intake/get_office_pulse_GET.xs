// Office live-pulse data. Returns latest event_log activity (most-recent
// N rows) + headline counts for today. Designed to be polled by
// office-pulse.html every 15-30s.
query get_office_pulse verb=GET {
  api_group = "intake"

  input {
    int? limit?
    int? since_ts_ms?
  }

  stack {
    var $limit_in {
      value = ($input.limit ?? 50)
    }
  
    var $effective_limit {
      value = ($limit_in > 100 ? 100 : ($limit_in < 1 ? 50 : $limit_in))
    }
  
    var $now_ct {
      value = now|transform_timestamp:"-5 hours"
    }
  
    var $today_str {
      value = $now_ct|format_timestamp:"Y-m-d"
    }
  
    var $day_start_utc {
      value = (($today_str ~ " 00:00:00")|to_timestamp)|transform_timestamp:"+5 hours"
    }
  
    var $day_end_utc {
      value = $day_start_utc|transform_timestamp:"+1 day"
    }
  
    // Activity feed
    var $since_ts_ms_in {
      value = ($input.since_ts_ms ?? 0)
    }
  
    var $since_ts {
      value = ($since_ts_ms_in > 0 ? (($since_ts_ms_in / 1000)|to_timestamp) : $day_start_utc)
    }
  
    db.query event_log {
      where = $db.event_log.created_at >= $since_ts
      sort = {event_log.created_at: "desc"}
      return = {
        type  : "list"
        paging: {page: 1, per_page: $effective_limit}
      }
    } as $event_rows
  
    // Headline counts — today only
    db.query jobs {
      where = $db.jobs.scheduling_status == "scheduled" && $db.jobs.scheduled_start >= $day_start_utc && $db.jobs.scheduled_start < $day_end_utc
      return = {type: "count"}
    } as $scheduled_today
  
    db.query jobs {
      where = $db.jobs.scheduling_status == "in_progress"
      return = {type: "count"}
    } as $in_progress
  
    db.query jobs {
      where = $db.jobs.scheduling_status == "completed" && $db.jobs.job_completed_at >= $day_start_utc && $db.jobs.job_completed_at < $day_end_utc
      return = {type: "count"}
    } as $completed_today
  
    db.query jobs {
      where = $db.jobs.scheduling_status == "awaiting_parts"
      return = {type: "count"}
    } as $awaiting_parts
  
    db.query jobs {
      where = $db.jobs.scheduling_status == "not_ready" && $db.jobs.created_at >= $day_start_utc
      return = {type: "count"}
    } as $not_ready_today
  }

  response = {
    success : true
    today_ct: $today_str
    headline: ```
      {
        scheduled_today  : ($scheduled_today ?? 0)
        in_progress      : ($in_progress ?? 0)
        completed_today  : ($completed_today ?? 0)
        awaiting_parts   : ($awaiting_parts ?? 0)
        not_ready_today  : ($not_ready_today ?? 0)
      }
      ```
    events  : $event_rows.items
  }

  guid = "get-office-pulse-v1"
}