query get_greeting_sent_for_job verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    var $cutoff {
      value = ((now|to_ms) - 86400000)
    }
  
    db.query event_log {
      where = $db.event_log.action == "new_job_greeting_sent" && $db.event_log.metadata.job_id == $input.job_id && $db.event_log.created_at >= $cutoff
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows
  
    var $first {
      value = (($rows.items|first) ?? null)
    }
  
    var $sent_flag {
      value = ($first != null)
    }
  
    var $last_at {
      value = ($first.created_at ?? null)
    }
  }

  response = {
    success     : true
    sent        : $sent_flag
    last_sent_at: $last_at
  }

  guid = "get-greeting-sent-for-job-v1"
}