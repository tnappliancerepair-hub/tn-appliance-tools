// Records a rate-limit hit for the given key. Called by endpoints
// after check_rate_limit passes + the protected action runs.
query record_rate_limit_hit verb=POST {
  api_group = "intake"

  input {
    text rate_key
  }

  stack {
    var $key {
      value = ($input.rate_key ?? "")|trim
    }

    precondition ($key != "") {
      error_type = "inputerror"
      error      = "rate_key required"
    }

    var $action_key {
      value = "rate_hit_" ~ $key
    }

    db.add event_log {
      data = {
        action  : $action_key
        metadata: {recorded_at_ms: (now|to_ms)}|json_encode
      }
    } as $row
  }

  response = {
    success : true
    row_id  : $row.id
  }

  guid = "record-rate-limit-hit-v1"
}
