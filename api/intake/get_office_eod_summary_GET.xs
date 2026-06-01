// EOD office summary data. Returns headline counts for today.
query get_office_eod_summary verb=GET {
  api_group = "intake"

  input {
  }

  stack {
    var $now_ts {
      value = now
    }
  
    var $now_ct {
      value = $now_ts|transform_timestamp:"-5 hours"
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
  
    // Completed today
    db.query jobs {
      where = $db.jobs.scheduling_status == "completed" && $db.jobs.job_completed_at != null && $db.jobs.job_completed_at >= $day_start_utc && $db.jobs.job_completed_at < $day_end_utc
      return = {type: "count"}
    } as $completed
  
    // Started today
    db.query jobs {
      where = $db.jobs.job_started_at != null && $db.jobs.job_started_at >= $day_start_utc && $db.jobs.job_started_at < $day_end_utc
      return = {type: "count"}
    } as $started
  
    // Canceled today
    db.query jobs {
      where = $db.jobs.scheduling_status == "canceled" && $db.jobs.created_at >= $day_start_utc && $db.jobs.created_at < $day_end_utc
      return = {type: "count"}
    } as $canceled_today
  
    // New jobs created today
    db.query jobs {
      where = $db.jobs.created_at >= $day_start_utc && $db.jobs.created_at < $day_end_utc
      return = {type: "count"}
    } as $new_jobs
  
    // Warranty submissions handled today (via Phase 5A digest agent)
    db.query event_log {
      where = $db.event_log.action == "warranty_submission_handled" && $db.event_log.created_at >= $day_start_utc && $db.event_log.created_at < $day_end_utc
      return = {type: "count"}
    } as $warranty_handled
  
    // TDR-blocked completion attempts today
    db.query event_log {
      where = $db.event_log.action == "tech_job_complete_blocked_tdr_incomplete" && $db.event_log.created_at >= $day_start_utc && $db.event_log.created_at < $day_end_utc
      return = {type: "count"}
    } as $tdr_blocks
  
    // Callback alerts today
    db.query event_log {
      where = $db.event_log.action == "callback_event_logged" && $db.event_log.created_at >= $day_start_utc && $db.event_log.created_at < $day_end_utc
      return = {type: "count"}
    } as $callbacks
  
    // Inbound calls today
    db.query event_log {
      where = $db.event_log.action == "inbound_call_received" && $db.event_log.created_at >= $day_start_utc && $db.event_log.created_at < $day_end_utc
      return = {type: "count"}
    } as $inbound_calls
  }

  response = {
    success         : true
    today_ct        : $today_str
    completed       : ($completed ?? 0)
    started         : ($started ?? 0)
    canceled        : ($canceled_today ?? 0)
    new_jobs        : ($new_jobs ?? 0)
    warranty_handled: ($warranty_handled ?? 0)
    tdr_blocks      : ($tdr_blocks ?? 0)
    callbacks       : ($callbacks ?? 0)
    inbound_calls   : ($inbound_calls ?? 0)
  }

  guid = "get-office-eod-summary-v1"
}