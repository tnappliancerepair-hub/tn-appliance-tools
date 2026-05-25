query get_warranty_submission_handled verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    var $cutoff {
      value = ((now|to_ms) - 604800000)
    }

    db.query event_log {
      where = $db.event_log.action == "warranty_submission_handled" && $db.event_log.metadata.job_id == $input.job_id && $db.event_log.created_at >= $cutoff
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    var $first {
      value = (($rows.items|first) ?? null)
    }

    var $handled_flag {
      value = ($first != null)
    }

    var $last_at {
      value = ($first.created_at ?? null)
    }
  }

  response = {
    success        : true
    handled        : $handled_flag
    last_handled_at: $last_at
  }

  guid = "get-warranty-submission-handled-v1"
}
