//  Simple rate-limit check based on event_log audit count for a given
//  action+key in the last window_seconds. Returns {allowed, current_count,
//  limit}.
// 
//  Callers POST to record_rate_limit_hit after passing the check.
query check_rate_limit verb=GET {
  api_group = "intake"

  input {
    text rate_key
    int? window_seconds?
    int? max_hits?
  }

  stack {
    var $key {
      value = ($input.rate_key ?? "")|trim
    }
  
    precondition ($key != "") {
      error_type = "inputerror"
      error = "rate_key required"
    }
  
    var $win {
      value = ($input.window_seconds ?? 60)
    }
  
    var $max {
      value = ($input.max_hits ?? 10)
    }
  
    var $now_ts {
      value = now
    }
  
    var $cutoff_ts {
      value = $now_ts
        |transform_timestamp:"-" ~ ($win|to_text) ~ " seconds"
    }
  
    var $action_key {
      value = "rate_hit_" ~ $key
    }
  
    db.query event_log {
      where = $db.event_log.action == $action_key && $db.event_log.created_at >= $cutoff_ts
      return = {type: "count"}
    } as $cnt
  
    var $current {
      value = ($cnt ?? 0)
    }
  
    var $allowed {
      value = ($current < $max)
    }
  }

  response = {
    success       : true
    rate_key      : $key
    current_count : $current
    limit         : $max
    window_seconds: $win
    allowed       : $allowed
  }

  guid = "check-rate-limit-v1"
}